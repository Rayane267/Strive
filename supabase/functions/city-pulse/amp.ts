// Info trafic de la Métropole Aix-Marseille-Provence (flux GTFS-RT Service
// Alerts, ouvert sans clé) → signaux `city_signals`.
//
// Le flux couvre toute la métropole (140 alertes, surtout des bus et des
// ascenseurs). On ne garde que le métro et le tram RTM, comme pour Paris.
//
// Module pur : il reçoit le flux déjà décodé (FeedMessage.toObject), le
// décodage protobuf est dans index.ts.

import type { SignalRow } from "./idfm.ts";

export const AMP_URL = "https://api-mobilite.rbgl.fr/api/v1/mamp/getServiceAlerts";

// route_id du GTFS RTM.
const LINES: Record<string, { label: string; mode: string; weight: number }> = {
  "RTM-116": { label: "Métro M1", mode: "metro", weight: 3 },
  "RTM-125": { label: "Métro M2", mode: "metro", weight: 3 },
  "RTM-2": { label: "Tram T1", mode: "tram", weight: 2 },
  "RTM-47": { label: "Tram T2", mode: "tram", weight: 2 },
  "RTM-48": { label: "Tram T3", mode: "tram", weight: 2 },
};

// Ce qui renvoie vraiment des voyageurs vers les VTC. Un ascenseur en panne
// (ACCESSIBILITY_ISSUE, l'essentiel du flux) ne le fait pas.
const EFFECTS = new Set(["NO_SERVICE", "REDUCED_SERVICE", "SIGNIFICANT_DELAYS", "MODIFIED_SERVICE"]);

type Translated = { translation?: { text: string; language?: string }[] };
type Alert = {
  activePeriod?: { start?: number; end?: number }[];
  informedEntity?: { routeId?: string; stopId?: string }[];
  cause?: string;
  effect?: string;
  headerText?: Translated;
  descriptionText?: Translated;
};

const fr = (t?: Translated) =>
  t?.translation?.find(x => x.language === "fr")?.text ?? t?.translation?.[0]?.text ?? null;

/** Epoch (s) → heure de Paris sans fuseau, « 2026-10-07T18:05:00 ». */
export const parisLocal = (epoch: number) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(epoch * 1000)).map(x => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

const DAY = 86_400;

export function ampSignals(
  feed: { entity?: { id: string; alert?: Alert }[] },
  nowEpoch: number,
): SignalRow[] {
  const rows: SignalRow[] = [];
  for (const e of feed.entity ?? []) {
    const a = e.alert;
    if (!a || !EFFECTS.has(a.effect ?? "")) continue;

    const lines = [...new Map(
      (a.informedEntity ?? [])
        .filter(i => i.routeId && LINES[i.routeId])
        .map(i => [i.routeId!, { ...LINES[i.routeId!], partial: !!i.stopId }]),
    ).values()];
    if (!lines.length) continue;

    // Période active ; sans borne de fin, l'alerte vaut jusqu'à nouvel ordre.
    const period = (a.activePeriod?.length ? a.activePeriod : [{}])
      .find(p => (p.start ?? 0) <= nowEpoch && nowEpoch <= (p.end || Infinity));
    if (!period) continue;
    const start = period.start ?? nowEpoch;
    const end = period.end || null;
    // Même règle que Paris : le chronique (> 7 j) sort, sauf s'il vient de commencer.
    if (end && end - start > 7 * DAY && nowEpoch - start >= DAY) continue;

    const main = lines.reduce((x, y) => (y.weight > x.weight ? y : x));
    const whole = lines.some(l => !l.partial);
    const strong = a.effect === "NO_SERVICE" || a.cause === "STRIKE";
    const intensity = Math.min(5, Math.max(1, main.weight + (strong ? 1 : 0) - (whole ? 0 : 1)));

    rows.push({
      id: e.id,
      city: "marseille",
      kind: "transit_disruption",
      title: fr(a.headerText) ?? `${main.label} perturbé`,
      detail: fr(a.descriptionText)?.slice(0, 400) ?? null,
      place: lines.map(l => l.label).join(", "),
      mode: main.mode,
      lat: null,
      lon: null,
      starts_local: parisLocal(start),
      ends_local: end ? parisLocal(end) : null,
      intensity,
    });
  }
  return rows.sort((x, y) => y.intensity - x.intensity);
}
