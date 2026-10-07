// Arrivées grandes lignes SNCF (API SNCF / Navitia) → une « vague » par gare.
//
// Une vague = la fenêtre de 30 min qui concentre le plus de voyageurs dans les
// 3 prochaines heures. C'est ce qui remplit une file de taxis, pas un TGV isolé.
//
// Module pur : la récupération HTTP est dans index.ts.

import { navitiaMs, navitiaToLocal, type SignalRow } from "./idfm.ts";

export const SNCF_BASE = "https://api.sncf.com/v1/coverage/sncf";

export const STATIONS: { id: string; city: string; name: string }[] = [
  { id: "87686006", city: "paris", name: "Gare de Lyon" },
  { id: "87271007", city: "paris", name: "Gare du Nord" },
  { id: "87113001", city: "paris", name: "Gare de l'Est" },
  { id: "87391003", city: "paris", name: "Montparnasse" },
  { id: "87547000", city: "paris", name: "Austerlitz" },
  { id: "87271494", city: "paris", name: "CDG 2 TGV" },
  { id: "87393702", city: "paris", name: "Massy TGV" },
  { id: "87111849", city: "paris", name: "Marne-la-Vallée – Chessy" },
  { id: "87723197", city: "lyon", name: "Lyon Part-Dieu" },
  { id: "87722025", city: "lyon", name: "Lyon Perrache" },
  { id: "87762906", city: "lyon", name: "Saint-Exupéry TGV" },
  { id: "87751008", city: "marseille", name: "Marseille Saint-Charles" },
  { id: "87319012", city: "marseille", name: "Aix-en-Provence TGV" },
  // Côte d'Azur : Nice Ville seule passe rarement le seuil de 600 voyageurs.
  { id: "87756056", city: "nice", name: "Nice Ville" },
  { id: "87757625", city: "nice", name: "Cannes" },
  { id: "87757674", city: "nice", name: "Antibes" },
];

// Ordres de grandeur de voyageurs par train, affichés « ≈ ». Les TER
// régionaux sont exclus : ce sont surtout des pendulaires, peu de VTC.
const SEATS: Record<string, number> = {
  "TGV INOUI": 500,
  "OUIGO": 600,
  "TGV Lyria": 350,
  "Intercités": 400,
  "Intercités de nuit": 300,
  "OUIGO Train Classique": 400,
  "DB SNCF": 450,
};

const FORBIDDEN = ["RapidTransit", "Bus", "Tramway", "Coach"]
  .map(m => `forbidden_uris%5B%5D=physical_mode:${m}`).join("&");

export const arrivalsUrl = (stationId: string, fromNavitia: string) =>
  `${SNCF_BASE}/stop_areas/stop_area:SNCF:${stationId}/arrivals` +
  `?duration=10800&count=100&data_freshness=realtime&from_datetime=${fromNavitia}&${FORBIDDEN}`;

type Arrival = {
  display_informations: {
    commercial_mode: string;
    trip_short_name?: string;
    links: { id: string; category?: string }[];
  };
  stop_date_time: { arrival_date_time: string; base_arrival_date_time?: string };
  stop_point: { coord: { lat: string; lon: string } };
};

type Train = { at: string; mode: string; number: string | null; origin: string | null; delay: number; seats: number };

const hhmm = (navitia: string) => `${navitia.slice(9, 11)}:${navitia.slice(11, 13)}`;
const WINDOW = 30 * 60_000;

export function sncfWave(
  station: (typeof STATIONS)[number],
  body: { arrivals?: Arrival[]; origins?: { id: string; name: string }[] },
): SignalRow | null {
  const origins = new Map((body.origins ?? []).map(o => [o.id, o.name]));
  const trains: Train[] = (body.arrivals ?? [])
    .filter(a => SEATS[a.display_informations.commercial_mode])
    .map(a => {
      const s = a.stop_date_time;
      const originId = a.display_informations.links.find(l => l.category === "origin")?.id;
      return {
        at: s.arrival_date_time,
        mode: a.display_informations.commercial_mode,
        number: a.display_informations.trip_short_name ?? null,
        // « Paris - Gare de Lyon - Hall 1 & 2 » → « Paris - Gare de Lyon »
        origin: originId ? origins.get(originId)?.replace(/ - Hall .*$/, "") ?? null : null,
        delay: s.base_arrival_date_time
          ? Math.max(0, Math.round((navitiaMs(s.arrival_date_time) - navitiaMs(s.base_arrival_date_time)) / 60_000))
          : 0,
        seats: SEATS[a.display_informations.commercial_mode],
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
  if (!trains.length) return null;

  // Fenêtre glissante de 30 min ancrée sur chaque arrivée.
  let best = { from: 0, to: 0, pax: 0 };
  for (let i = 0; i < trains.length; i++) {
    let pax = 0, j = i;
    while (j < trains.length && navitiaMs(trains[j].at) - navitiaMs(trains[i].at) <= WINDOW) pax += trains[j++].seats;
    if (pax > best.pax) best = { from: i, to: j - 1, pax };
  }
  // Un TGV isolé ne fait pas une file de voyageurs.
  if (best.pax < 600) return null;
  const wave = trains.slice(best.from, best.to + 1);
  const first = wave[0].at, last = wave[wave.length - 1].at;

  // Après 23 h, le métro ferme bientôt : une même vague pèse plus lourd.
  const late = +first.slice(9, 11) >= 23 || +first.slice(9, 11) < 5;
  const base = best.pax >= 3000 ? 5 : best.pax >= 2000 ? 4 : best.pax >= 1200 ? 3 : best.pax >= 600 ? 2 : 1;
  const intensity = Math.min(5, base + (late ? 1 : 0));

  const n = wave.length;
  const pax = Math.round(best.pax / 100) * 100;
  const coord = (body.arrivals ?? [])[0]?.stop_point.coord;

  return {
    id: `wave:${station.id}`,
    city: station.city,
    kind: "train_arrivals",
    title: `${n} train${n > 1 ? "s" : ""} grandes lignes`,
    detail: `≈ ${pax.toLocaleString("fr-FR")} voyageurs ` +
      (first === last ? `à ${hhmm(first)}` : `entre ${hhmm(first)} et ${hhmm(last)}`),
    place: station.name,
    mode: "train",
    lat: coord ? +coord.lat : null,
    lon: coord ? +coord.lon : null,
    starts_local: navitiaToLocal(first),
    ends_local: navitiaToLocal(last),
    intensity,
    items: wave.map(t => ({
      at: hhmm(t.at), mode: t.mode, number: t.number, origin: t.origin, delay: t.delay, seats: t.seats,
    })),
  };
}
