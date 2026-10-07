// Alertes trafic TCL (Data Grand Lyon, SIRI Lite « situation-exchange »)
// → signaux `city_signals`. Accès authentifié : compte de la plateforme de
// données Grand Lyon (≠ compte Grand Lyon Connect), en Basic Auth.
//
// Module pur : la récupération HTTP est dans index.ts.

import type { SignalRow } from "./idfm.ts";
import { parisLocal } from "./amp.ts";

export const TCL_URL = "https://data.grandlyon.com/siri-lite/2.0/situation-exchange.json";

// LineRef « ActIV:Line::<nom court>:SYTRAL ». Le nom seul distingue le métro
// C (« C ») des bus C2, C12… d'où les ancres.
const classify = (code: string) =>
  /^[ABCD]$/.test(code) ? { label: `Métro ${code}`, mode: "metro", weight: 3 }
  : /^T\d+$/.test(code) ? { label: `Tram ${code}`, mode: "tram", weight: 2 }
  : /^F\d$/.test(code) ? { label: `Funiculaire ${code}`, mode: "metro", weight: 2 }
  : null;

// Le flux ne porte ni gravité ni effet exploitable : on lit le texte.
const STRONG = /interromp|interruption|ne circule pas|aucun (métro|tram|train)|trafic (arrêté|coupé)|grève|mouvement social/i;

type Text = { value?: string }[];
type Situation = {
  SituationNumber?: { value: string };
  ValidityPeriod?: { StartTime?: string; EndTime?: string }[];
  Summary?: Text;
  Description?: Text;
  Consequences?: {
    Consequence?: {
      Affects?: { Networks?: { AffectedNetwork?: { AffectedLine?: { LineRef?: { value: string } }[] }[] } };
    }[];
  };
};

const DAY = 86_400;

export function tclSignals(body: unknown, nowEpoch: number): SignalRow[] {
  const situations: Situation[] =
    (body as any)?.Siri?.ServiceDelivery?.SituationExchangeDelivery?.[0]?.Situations?.PtSituationElement ?? [];

  // Le flux publie chaque situation en plusieurs morceaux (« …_1 », « …_2 »),
  // un texte court et un texte long : on les regroupe.
  const groups = new Map<string, Situation[]>();
  for (const s of situations) {
    const key = (s.SituationNumber?.value ?? "").replace(/_\d+$/, "");
    if (key) groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const rows: SignalRow[] = [];
  for (const [key, parts] of groups) {
    const lines = [...new Map(parts
      .flatMap(s => s.Consequences?.Consequence ?? [])
      .flatMap(c => c.Affects?.Networks?.AffectedNetwork ?? [])
      .flatMap(n => n.AffectedLine ?? [])
      .map(l => classify(l.LineRef?.value.split("::")[1]?.split(":")[0] ?? ""))
      .filter(<T>(x: T | null): x is T => x !== null)
      .map(l => [l.label, l] as const)).values()];
    if (!lines.length) continue;

    const period = parts.flatMap(s => s.ValidityPeriod ?? []).find(p => {
      const a = p.StartTime ? Date.parse(p.StartTime) / 1000 : 0;
      const b = p.EndTime ? Date.parse(p.EndTime) / 1000 : Infinity;
      return a <= nowEpoch && nowEpoch <= b;
    });
    if (!period) continue;
    const start = period.StartTime ? Math.floor(Date.parse(period.StartTime) / 1000) : nowEpoch;
    const end = period.EndTime ? Math.floor(Date.parse(period.EndTime) / 1000) : null;
    // Même règle que Paris et Marseille : le chronique sort, sauf s'il est neuf.
    if (end && end - start > 7 * DAY && nowEpoch - start >= DAY) continue;

    const texts = parts.flatMap(s => [...(s.Summary ?? []), ...(s.Description ?? [])])
      .map(t => t.value?.trim()).filter((t): t is string => !!t)
      .sort((a, b) => a.length - b.length);
    const main = lines.reduce((x, y) => (y.weight > x.weight ? y : x));
    const strong = texts.some(t => STRONG.test(t));
    const place = lines.map(l => l.label).join(", ");

    rows.push({
      id: key,
      city: "lyon",
      kind: "transit_disruption",
      title: texts[0] ? `${place} : ${texts[0]}`.slice(0, 160) : `${place} perturbé`,
      detail: texts.length > 1 ? texts[texts.length - 1].slice(0, 400) : null,
      place,
      mode: main.mode,
      lat: null,
      lon: null,
      starts_local: parisLocal(start),
      ends_local: end ? parisLocal(end) : null,
      intensity: Math.min(5, main.weight + (strong ? 1 : 0)),
    });
  }
  return rows.sort((a, b) => b.intensity - a.intensity);
}
