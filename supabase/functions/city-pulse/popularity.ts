// Affluence attendue des concerts : capacité de la salle × remplissage
// probable, déduit de la popularité de l'artiste (API publique Deezer, sans clé).
//
// À salle égale, l'affluence dépend de l'artiste : Tyla et un groupe de 4 000
// fans remplissent le même Zénith sur le papier, pas dans la rue à 22 h 30. Et
// un artiste peu suivi ne remplit pas davantage l'Accor Arena. Le nombre de
// fans Deezer est un indicateur imparfait mais objectif.
//
// Garde-fous : seul un nom qui correspond EXACTEMENT est retenu, le plus suivi
// des homonymes (Deezer sort parfois un petit « Muse » avant le vrai) ; un
// artiste introuvable ou une erreur Deezer donnent un remplissage par défaut.

import type { SignalRow } from "./idfm.ts";

/** Remplissage probable selon le nombre de fans Deezer. */
function fillRate(fans: number | null): number {
  if (fans == null) return 0.85; // inconnu : on ne pénalise pas
  if (fans >= 500_000) return 1;
  if (fans >= 150_000) return 0.85;
  if (fans >= 50_000) return 0.6;
  if (fans >= 20_000) return 0.45;
  return 0.25;
}

/** Même échelle pour tous les événements : c'est la foule qui compte. */
export function intensityFor(people: number): number {
  return people >= 40_000 ? 5 : people >= 15_000 ? 4 : people >= 5_000 ? 3 : people >= 2_500 ? 2 : 1;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

async function fans(artist: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.deezer.com/search/artist?limit=10&q=${encodeURIComponent(artist)}`,
      { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const hits: number[] = ((await res.json()).data ?? [])
      .filter((a: { name: string; nb_fan?: number }) => norm(a.name) === norm(artist) && typeof a.nb_fan === "number")
      .map((a: { nb_fan: number }) => a.nb_fan);
    return hits.length ? Math.max(...hits) : null;
  } catch {
    return null;
  }
}

const seatsOf = (detail: string | null) =>
  Number(detail?.match(/≈\s*([\d\s  ]+)\s*places/)?.[1]?.replace(/\D/g, "") ?? 0);

export async function adjustByPopularity(rows: SignalRow[]): Promise<SignalRow[]> {
  const artists = [...new Set(rows.filter(r => r.mode === "concert").map(r => r.title))];
  const known = new Map<string, number | null>();
  // 8 requêtes à la fois : bien sous la limite Deezer (50 par 5 s).
  for (let i = 0; i < artists.length; i += 8) {
    const batch = artists.slice(i, i + 8);
    const res = await Promise.all(batch.map(fans));
    batch.forEach((a, j) => known.set(a, res[j]));
  }
  return rows.map(r => {
    if (r.mode !== "concert") return r;
    const seats = seatsOf(r.detail);
    if (!seats) return r;
    // Une arena ou un stade ne programme pas un inconnu : au moins 60 % de
    // remplissage, même si Deezer ne retrouve qu'un homonyme (« Korn » pour KoЯn).
    const fill = Math.max(fillRate(known.get(r.title) ?? null), seats >= 15_000 ? 0.6 : 0);
    const people = Math.round((seats * fill) / 100) * 100;
    return {
      ...r,
      // Le détail porte désormais l'affluence attendue, pas la jauge.
      detail: r.detail!.replace(/≈\s*[\d\s  ]+\s*places/, `≈ ${people.toLocaleString("fr-FR")} personnes`),
      intensity: intensityFor(people),
    };
  });
}
