// Matchs de Ligue 1 à domicile dans les 4 villes, 2 mois devant → événements (onglet
// « Événements »). Source : openfootball/football.json, domaine public (CC0),
// sans clé. Ne couvre ni la Ligue des champions ni le rugby.
//
// Les heures sont celles du calendrier publié ; les diffuseurs TV les
// recalent parfois tard, d'où le « ≈ » de l'heure de fin.
//
// Module pur : la récupération HTTP est dans index.ts.

import type { SignalRow } from "./idfm.ts";
import { EVENTS_AHEAD_DAYS } from "./curated.ts";

/** Saison en cours au format openfootball (« 2026-27 »), bascule en juillet. */
export function footballUrl(now = new Date()): string {
  const y = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  return `https://raw.githubusercontent.com/openfootball/football.json/master/${y}-${String(y + 1).slice(2)}/fr.1.json`;
}

// Clubs dont le stade est dans une des 4 zones. Monaco est servi par les
// chauffeurs de Nice.
const HOME: Record<string, { short: string; venue: string; city: string; seats: number; lat: number; lon: number }> = {
  "Paris Saint-Germain FC": { short: "PSG", venue: "Parc des Princes", city: "paris", seats: 48_000, lat: 48.8414, lon: 2.2530 },
  "Paris FC": { short: "Paris FC", venue: "Stade Jean-Bouin", city: "paris", seats: 20_000, lat: 48.8433, lon: 2.2525 },
  "Olympique Lyonnais": { short: "OL", venue: "Groupama Stadium", city: "lyon", seats: 59_000, lat: 45.7653, lon: 4.9822 },
  "Olympique de Marseille": { short: "OM", venue: "Orange Vélodrome", city: "marseille", seats: 67_000, lat: 43.2698, lon: 5.3959 },
  "OGC Nice": { short: "OGC Nice", venue: "Allianz Riviera", city: "nice", seats: 36_000, lat: 43.7051, lon: 7.1926 },
  "AS Monaco FC": { short: "Monaco", venue: "Stade Louis-II", city: "nice", seats: 18_500, lat: 43.7276, lon: 7.4155 },
};

// Noms d'affichage des adversaires (saison 2026-27). Un club promu absent de
// la table s'affiche sous son nom officiel : moins joli, jamais faux.
const SHORT: Record<string, string> = {
  "AJ Auxerre": "Auxerre", "Angers SCO": "Angers", "ES Troyes AC": "Troyes",
  "FC Lorient": "Lorient", "Le Havre AC": "Le Havre", "Le Mans FC": "Le Mans",
  "Lille OSC": "Lille", "RC Strasbourg Alsace": "Strasbourg", "Racing Club de Lens": "Lens",
  "Stade Brestois 29": "Brest", "Stade Rennais FC 1901": "Rennes", "Toulouse FC": "Toulouse",
};
const shortName = (team: string) => HOME[team]?.short ?? SHORT[team] ?? team;

type Match = { date: string; time?: string; team1: string; team2: string };

const DAY = 86_400_000;

export function footballEvents(body: { matches?: Match[] }, now = new Date()): SignalRow[] {
  const from = now.getTime() - DAY / 4; // un match en cours reste visible
  const to = now.getTime() + EVENTS_AHEAD_DAYS * DAY;
  const rows: SignalRow[] = [];

  for (const m of body.matches ?? []) {
    const home = HOME[m.team1];
    if (!home) continue;
    const day = Date.parse(`${m.date}T12:00:00Z`);
    if (day < from || day > to) continue;

    const time = m.time?.match(/^\d{2}:\d{2}$/) ? m.time : null;
    // Fin ≈ coup d'envoi + 1 h 55 (deux mi-temps, pause, arrêts de jeu).
    let ends: string | null = null;
    if (time) {
      const [h, min] = time.split(":").map(Number);
      const end = h * 60 + min + 115;
      const endDay = new Date(Date.parse(`${m.date}T00:00:00Z`) + Math.floor(end / 1440) * DAY).toISOString().slice(0, 10);
      ends = `${endDay}T${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}:00`;
    }

    rows.push({
      id: `${m.date}:${m.team1}`,
      city: home.city,
      kind: "event",
      title: `${home.short} – ${shortName(m.team2)}`,
      detail: time ? `Coup d'envoi ${time} · ≈ ${home.seats.toLocaleString("fr-FR")} places` : "Horaire à confirmer",
      place: home.venue,
      mode: "match",
      lat: home.lat,
      lon: home.lon,
      starts_local: `${m.date}T${time ?? "00:00"}:00`,
      ends_local: ends,
      intensity: home.seats >= 45_000 ? 5 : home.seats >= 30_000 ? 4 : 3,
    });
  }
  return rows;
}
