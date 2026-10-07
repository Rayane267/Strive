// Perturbations Île-de-France Mobilités (PRIM, « Messages Info Trafic -
// Requête globale ») → signaux `city_signals`.
//
// Module pur, sans API Deno : testable avec Node sur une réponse enregistrée.

export const IDFM_URL =
  "https://prim.iledefrance-mobilites.fr/marketplace/disruptions_bulk/disruptions/v2";

export type SignalRow = {
  id: string;
  city: string;
  kind: string;
  title: string;
  detail: string | null;
  place: string | null;
  mode: string | null;
  lat: number | null;
  lon: number | null;
  starts_local: string | null;
  ends_local: string | null;
  intensity: number;
  items?: unknown[];
};

type Period = { begin: string; end: string };
type Disruption = {
  id: string;
  applicationPeriods: Period[];
  cause: string;
  severity: string;
  title: string;
  message?: string;
  shortMessage?: string;
};
type Line = {
  id: string;
  shortName: string;
  mode: string;
  impactedObjects: { type: string; disruptionIds: string[] }[];
};

// Seuls les modes lourds déplacent assez de voyageurs vers les VTC. Les bus
// (650 lignes, surtout des déviations) noieraient la liste.
const MODES: Record<string, { mode: string; label: (n: string) => string; weight: number }> = {
  RapidTransit: { mode: "rer", label: n => `RER ${n}`, weight: 4 },
  Metro: { mode: "metro", label: n => `Métro ${n}`, weight: 3 },
  LocalTrain: { mode: "train", label: n => `Ligne ${n}`, weight: 3 },
  Tramway: { mode: "tram", label: n => `Tram ${n}`, weight: 2 },
};

// « 20261007T180500 » (heure de Paris, sans fuseau) → « 2026-10-07T18:05:00 ».
export const navitiaToLocal = (s: string) =>
  `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`;

// Les deux bornes sont dans le même fuseau implicite : on ne s'en sert que
// pour des écarts, la lecture en UTC ne fausse rien.
export const navitiaMs = (s: string) =>
  Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));

const DAY = 86_400_000;

const stripHtml = (s: string) =>
  s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();

/** `now` au format Navitia, heure de Paris (« 20261007T183000 »). */
export function parisNow(date = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date).map(x => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}

export function idfmSignals(
  body: { disruptions: Disruption[]; lines: Line[] },
  now: string,
): SignalRow[] {
  // disruptionId → lignes lourdes touchées, et si la ligne entière l'est.
  const touched = new Map<string, { label: string; mode: string; weight: number; whole: boolean }[]>();
  for (const line of body.lines ?? []) {
    const m = MODES[line.mode];
    if (!m) continue;
    for (const obj of line.impactedObjects ?? []) {
      for (const id of obj.disruptionIds ?? []) {
        const list = touched.get(id) ?? [];
        const existing = list.find(x => x.label === m.label(line.shortName));
        if (existing) existing.whole ||= obj.type === "line";
        else list.push({ label: m.label(line.shortName), mode: m.mode, weight: m.weight, whole: obj.type === "line" });
        touched.set(id, list);
      }
    }
  }

  const rows: SignalRow[] = [];
  for (const d of body.disruptions ?? []) {
    const lines = touched.get(d.id);
    if (!lines?.length) continue;
    if (d.severity === "INFORMATION" || d.cause === "INFORMATION") continue;
    // Des travaux qui ne coupent rien (quai fermé, ascenseur) ne changent pas la demande.
    if (d.cause === "TRAVAUX" && d.severity !== "BLOQUANTE") continue;
    const period = d.applicationPeriods.find(p => p.begin <= now && now <= p.end);
    if (!period) continue;
    // Une station fermée depuis trois mois n'est plus une info : les voyageurs
    // se sont adaptés. On garde le ponctuel (≤ 7 jours, grèves comprises) et
    // ce qui vient de commencer.
    const lasting = navitiaMs(period.end) - navitiaMs(period.begin) > 7 * DAY;
    const fresh = navitiaMs(now) - navitiaMs(period.begin) < DAY;
    if (lasting && !fresh) continue;

    const main = lines.reduce((a, b) => (b.weight > a.weight ? b : a));
    const whole = lines.some(l => l.whole);
    const intensity = Math.min(5, Math.max(1,
      main.weight + (d.severity === "BLOQUANTE" ? 1 : 0) - (whole ? 0 : 1)));

    rows.push({
      id: d.id,
      city: "paris",
      kind: "transit_disruption",
      title: d.title,
      detail: d.message ? stripHtml(d.message).slice(0, 400) : (d.shortMessage ?? null),
      place: lines.map(l => l.label).join(", "),
      mode: main.mode,
      lat: null,
      lon: null,
      starts_local: navitiaToLocal(period.begin),
      ends_local: navitiaToLocal(period.end),
      intensity,
    });
  }
  return rows.sort((a, b) => b.intensity - a.intensity);
}
