// Filtre des concerts : fans Deezer PAR PLACE de la salle.
//
// Ce qui fait une file de VTC à la sortie, c'est une salle pleine d'un public
// motivé. Le rapport fans / places le mesure simplement : Tyla, 193 000 fans
// pour un Zénith de 6 300 places (31 par place), remplit mieux sa salle que
// Youssou N'Dour, 211 000 fans pour 20 300 places à l'Accor Arena (10 par
// place). Gradur au même Accor Arena : 71 par place.
//
// Au-dessus du seuil, au moins l'intensité 3 (affichée) ; en dessous, 2, que
// l'app n'affiche pas.
//
// GENRE : le rock, le metal et l'alternatif sont écartés quel que soit le
// ratio (Muse, Placebo, Deep Purple… : public qui ne fait pas la file de VTC).
// Rap, R&B, afro, pop et K-pop restent soumis au seul ratio.
//
// Garde-fous : nom EXACT seulement, le plus suivi des homonymes. Artiste
// introuvable ou profil quasi vide (homonyme, nom stylisé : « Korn » pour
// KoЯn) : gardé dans une grande salle (une arena ne programme pas un inconnu),
// retiré ailleurs.

import type { SignalRow } from "./idfm.ts";

/** Fans Deezer par place à partir duquel une salle se remplit vraiment. */
const MIN_FANS_PER_SEAT = 25;
/** En dessous, le profil Deezer trouvé n'est pas le bon artiste. */
const SUSPICIOUS_FANS = 1_000;
const BIG_VENUE = 15_000;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Identifiants de genre Deezer écartés : Rock, Metal, Alternative.
const EXCLUDED_GENRES = new Set([152, 464, 85]);

type Artist = { fans: number; genre: number | null };

const get = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const body = await res.json();
  // Quota dépassé : Deezer répond 200 avec { error: … }.
  if (body?.error) throw new Error(`Deezer ${body.error.code ?? "?"}`);
  return body;
};

async function lookup(artist: string): Promise<Artist | null> {
  try {
    const best = ((await get(`https://api.deezer.com/search/artist?limit=10&q=${encodeURIComponent(artist)}`)).data ?? [])
      .filter((a: { name: string; nb_fan?: number }) => norm(a.name) === norm(artist) && typeof a.nb_fan === "number")
      .sort((a: { nb_fan: number }, b: { nb_fan: number }) => b.nb_fan - a.nb_fan)[0];
    if (!best) return null;
    // Genre principal = le plus fréquent parmi ses albums.
    const counts = new Map<number, number>();
    for (const al of (await get(`https://api.deezer.com/artist/${best.id}/albums?limit=50`)).data ?? []) {
      if (al.genre_id > 0) counts.set(al.genre_id, (counts.get(al.genre_id) ?? 0) + 1);
    }
    const genre = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { fans: best.nb_fan, genre };
  } catch {
    return null;
  }
}

const seatsOf = (detail: string | null) =>
  Number(detail?.match(/≈\s*([\d\s  ]+)\s*places/)?.[1]?.replace(/\D/g, "") ?? 0);

export async function adjustByPopularity(rows: SignalRow[]): Promise<SignalRow[]> {
  const artists = [...new Set(rows.filter(r => r.mode === "concert").map(r => r.title))];
  const known = new Map<string, Artist | null>();
  // 6 artistes (2 requêtes chacun) puis une pause : ≈ 40 requêtes par 5 s,
  // sous la limite Deezer de 50.
  for (let i = 0; i < artists.length; i += 6) {
    const batch = artists.slice(i, i + 6);
    const res = await Promise.all(batch.map(lookup));
    batch.forEach((a, j) => known.set(a, res[j]));
    if (i + 6 < artists.length) await sleep(1600);
  }
  return rows.map(r => {
    if (r.mode !== "concert") return r;
    const seats = seatsOf(r.detail);
    if (!seats) return r;
    const a = known.get(r.title) ?? null;
    const unsure = a == null || a.fans < SUSPICIOUS_FANS;
    const keep = unsure
      ? seats >= BIG_VENUE
      : !EXCLUDED_GENRES.has(a.genre ?? -1) && a.fans / seats >= MIN_FANS_PER_SEAT;
    // Gardé : au moins le niveau affiché (3), même dans un Zénith de 6 300 places.
    return { ...r, intensity: keep ? Math.max(r.intensity, 3) : Math.min(r.intensity, 2) };
  });
}
