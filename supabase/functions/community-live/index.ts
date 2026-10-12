// ═══════════════════════════════════════════════════════════════════════════
// community-live — la carte en direct, en cellules H3
// ═══════════════════════════════════════════════════════════════════════════
// Les offres scannées par tous les chauffeurs dans les dernières minutes,
// regroupées sur la grille H3 d'Uber (h3-js, la bibliothèque officielle) :
// l'extension Postgres h3 n'existe pas sur Supabase, le calcul se fait donc ici.
//
// ANONYMAT. Une cellule n'est publiable qu'avec au moins `min_rides` offres de
// `min_drivers` chauffeurs distincts (jamais moins de 2). Le lissage ne fait
// ensuite que redistribuer ce qui est déjà publiable. Aucune position de
// départ ne sort de la fonction : seulement des cellules, centre et contour.
//
// FRAÎCHEUR. Une offre compte moitié moins tous les `half_life_minutes` : une
// zone qui se vide glisse vers l'indigo puis s'éteint, une zone qui démarre se
// colore tout de suite. L'anonymat, lui, se vérifie sur le nombre RÉEL
// d'offres et de chauffeurs, jamais sur ce score pondéré.
//
// LISSAGE. Chaque cellule devient une moyenne pondérée d'elle-même (poids 1)
// et de ses voisines publiables (poids `neighbor_weight` chacune) : une cellule
// isolée garde sa valeur, une cellule entourée se rapproche de ses voisines,
// sans que le total ne gonfle. Une cellule vide entourée d'au moins deux
// voisines actives est comblée de la même façon. D'où des zones continues.
//
// SIMULATION (admin). `simulate: true` remplace les offres réelles par des
// offres inventées autour de la vue, qui passent par le même calcul. Réservé
// aux profils `is_admin` : la vérification est faite ici, pas dans l'app.
//
// ZONES. Les cellules affichées qui se touchent forment une zone. Chaque zone
// renvoie un seul point — sa cellule la plus chaude, où l'app pose l'éclair —
// et le nombre d'offres scannées dans la zone sur la dernière heure.
//
// Réglages : table `live_map_settings` (20261008, 20261009).
//
// Setup :
//   supabase functions deploy community-live      # JWT vérifié par défaut
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { cellToBoundary, cellToLatLng, gridDisk, latLngToCell, polygonToCells } from 'npm:h3-js@4.2.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/** Le serveur refuse une emprise plus large (même limite que community_live). */
const MAX_DLAT = 3;
const MAX_DLON = 4;
/** Cellules renvoyées au plus : les plus chaudes d'abord. */
const MAX_CELLS = 400;
/** L'éclair d'une zone annonce les offres de la dernière heure. */
const HOUR_MIN = 60;
/** Zones renvoyées au plus. */
const MAX_ZONES = 60;
/** Offres lues au plus sur la fenêtre : garde-fou mémoire. */
const MAX_RIDES = 50_000;

type Settings = {
  window_minutes: number;
  min_rides: number;
  min_drivers: number;
  hot_rides: number;
  h3_res: number;
  neighbor_weight: number;
  half_life_minutes: number;
};
const DEFAULTS: Settings = {
  window_minutes: 30,
  min_rides: 3,
  min_drivers: 2,
  hot_rides: 10,
  h3_res: 8,
  neighbor_weight: 0.35,
  half_life_minutes: 10,
};

type Bounds = { minLat: number; minLon: number; maxLat: number; maxLon: number };
/** `age` : minutes écoulées depuis le scan. */
type Point = { user: string; lat: number; lon: number; fare: number; km: number; age: number };

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function userId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token === SUPABASE_ANON_KEY) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

function parseBounds(b: Record<string, unknown>): Bounds | null {
  const n = (k: string) => (typeof b[k] === 'number' && Number.isFinite(b[k]) ? (b[k] as number) : NaN);
  const out = { minLat: n('minLat'), minLon: n('minLon'), maxLat: n('maxLat'), maxLon: n('maxLon') };
  if (Object.values(out).some(Number.isNaN)) return null;
  if (out.maxLat <= out.minLat || out.maxLon <= out.minLon) return null;
  if (out.maxLat - out.minLat > MAX_DLAT || out.maxLon - out.minLon > MAX_DLON) return null;
  return out;
}

// ─── Offres réelles ────────────────────────────────────────────────────────

async function realPoints(b: Bounds, s: Settings): Promise<Point[]> {
  // Au moins l'heure : le direct n'en garde que `window_minutes`, l'éclair
  // compte l'heure entière.
  const since = new Date(Date.now() - Math.max(s.window_minutes, HOUR_MIN) * 60_000).toISOString();
  // Une demi-cellule de marge : les cellules du bord reçoivent leurs voisines.
  const m = 0.01;
  const { data, error } = await admin
    .from('rides')
    .select('user_id, pickup_lat, pickup_lon, fare_final, fare_estimated, fx_rate_eur, distance_km, created_at')
    .gte('created_at', since)
    .not('pickup_lat', 'is', null)
    .gte('pickup_lat', b.minLat - m)
    .lte('pickup_lat', b.maxLat + m)
    .gte('pickup_lon', b.minLon - m * 1.5)
    .lte('pickup_lon', b.maxLon + m * 1.5)
    .limit(MAX_RIDES);
  if (error) throw error;
  const out: Point[] = [];
  for (const r of data ?? []) {
    const fare = Number(r.fare_final ?? r.fare_estimated);
    if (!(fare >= 1 && fare <= 1000)) continue;
    out.push({
      user: r.user_id,
      lat: Number(r.pickup_lat),
      lon: Number(r.pickup_lon),
      fare: fare / (Number(r.fx_rate_eur) || 1),
      km: Number(r.distance_km) || 0,
      age: Math.max(0, (Date.now() - Date.parse(r.created_at)) / 60_000),
    });
  }
  return out;
}

// ─── Offres simulées (admin) ───────────────────────────────────────────────

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (str: string) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h | 0;
};

/**
 * Des foyers ancrés à des cellules H3 de résolution 6 (≈ 36 km²) : ils restent
 * à leur place quand la vue bouge. Chaque foyer est fait de 2 à 4 lobes, chaud
 * au cœur, tiède au bord ; un sur trois ne fait que tiédir. Un foyer sur deux
 * est en train de naître (offres récentes), l'autre de s'éteindre (offres
 * anciennes) : la fraîcheur se voit. Leur intensité respire d'une minute à
 * l'autre. Les offres inventées viennent de plusieurs
 * faux chauffeurs, pour passer le seuil d'anonymat comme de vraies.
 */
function simulatedPoints(b: Bounds, s: Settings): Point[] {
  const ring: [number, number][] = [
    [b.minLat, b.minLon], [b.minLat, b.maxLon], [b.maxLat, b.maxLon], [b.maxLat, b.minLon], [b.minLat, b.minLon],
  ];
  const tiles = polygonToCells(ring, 6);
  if (tiles.length === 0 || tiles.length > 600) return [];
  const odds = Math.min(0.6, 10 / tiles.length);
  const minute = Math.floor(Date.now() / 60_000);
  const out: Point[] = [];
  for (const tile of tiles) {
    const place = rng(hash(tile));
    if (place() > odds) continue;
    const pulse = rng(hash(tile) + minute * 104729);
    const [tLat, tLon] = cellToLatLng(tile);
    const center = latLngToCell(tLat + (place() - 0.5) * 0.03, tLon + (place() - 0.5) * 0.045, s.h3_res);
    const heat = place();
    const peak = 5 + 26 * Math.pow(heat, 1.2);
    const breath = 0.8 + 0.4 * pulse();
    const kmRate = 1.1 + place() * 1.4;
    const rising = place() < 0.5;
    const near = gridDisk(center, 1);
    const lobes = Array.from({ length: 2 + Math.floor(place() * 3) }, (_, k) => {
      const [la, lo] = cellToLatLng(k === 0 ? center : near[Math.floor(place() * near.length)]);
      return { la, lo, r: 0.8 + place() * 1.0, w: k === 0 ? 1 : 0.55 + 0.45 * place() };
    });
    // Écart entre deux centres voisins, en degrés de latitude, pour mesurer
    // les distances en « cellules ».
    const [c0la, c0lo] = cellToLatLng(center);
    const [n1la, n1lo] = cellToLatLng(gridDisk(center, 1).find(c => c !== center)!);
    const step = Math.hypot(n1la - c0la, (n1lo - c0lo) * Math.cos((c0la * Math.PI) / 180));
    for (const cell of gridDisk(center, 4)) {
      const [la, lo] = cellToLatLng(cell);
      let v = 0;
      for (const l of lobes) {
        const d = Math.hypot(la - l.la, (lo - l.lo) * Math.cos((la * Math.PI) / 180)) / step / l.r;
        v = Math.max(v, l.w * Math.exp(-d * d));
      }
      const grain = 0.75 + 0.5 * rng(hash(cell))();
      const n = Math.round(peak * breath * v * grain);
      for (let i = 0; i < n; i++) {
        const km = 4 + pulse() * 8;
        // Naissant : offres des 8 dernières minutes ; finissant : de la fin de fenêtre.
        const u = pulse();
        const age = rising ? 8 * u : s.window_minutes * (0.45 + 0.55 * u) + 20 * pulse();
        out.push({ user: `sim-${i % 3}`, lat: la, lon: lo, fare: km * kmRate, km, age });
      }
    }
  }
  return out;
}

// ─── Agrégation H3 + lissage ───────────────────────────────────────────────

function aggregate(points: Point[], b: Bounds, s: Settings) {
  // `rides` : nombre réel (anonymat) ; `fresh` : le même, pondéré par l'âge.
  type Cell = { rides: number; fresh: number; users: Set<string>; fare: number; km: number };
  const cells = new Map<string, Cell>();
  // Recalage : avec des offres arrivant au même rythme toute la fenêtre, le
  // poids moyen vaut `mean` ; on le divise pour qu'une activité régulière
  // garde l'échelle des nombres réels (et donc les mêmes couleurs). Seul
  // l'écart à ce régime — plus frais ou plus ancien — déplace la couleur.
  const hl = s.half_life_minutes;
  const mean = ((hl / Math.LN2) * (1 - Math.pow(0.5, s.window_minutes / hl))) / s.window_minutes;
  for (const p of points) {
    if (p.age > s.window_minutes) continue; // l'heure entière ne sert qu'à l'éclair
    const id = latLngToCell(p.lat, p.lon, s.h3_res);
    let c = cells.get(id);
    if (!c) cells.set(id, (c = { rides: 0, fresh: 0, users: new Set(), fare: 0, km: 0 }));
    c.rides++;
    c.fresh += Math.pow(0.5, p.age / hl) / mean;
    c.users.add(p.user);
    if (p.km > 0) {
      c.fare += p.fare;
      c.km += p.km;
    }
  }

  // Seuil d'anonymat AVANT le lissage.
  const minDrivers = Math.max(2, s.min_drivers);
  const pub = new Map<string, Cell>();
  for (const [id, c] of cells) {
    if (c.rides >= s.min_rides && c.users.size >= minDrivers) pub.set(id, c);
  }

  const spill = new Map<string, { sum: number; n: number }>();
  for (const [id, c] of pub) {
    for (const nb of gridDisk(id, 1)) {
      if (nb === id) continue;
      const e = spill.get(nb) ?? { sum: 0, n: 0 };
      e.sum += c.fresh;
      e.n++;
      spill.set(nb, e);
    }
  }

  const w = s.neighbor_weight;
  const scored: { id: string; score: number; own: Cell | null }[] = [];
  for (const [id, c] of pub) {
    const e = spill.get(id) ?? { sum: 0, n: 0 };
    scored.push({ id, score: (c.fresh + w * e.sum) / (1 + w * e.n), own: c });
  }
  for (const [id, e] of spill) {
    if (pub.has(id) || e.n < 2) continue;
    scored.push({ id, score: (w * e.sum) / (1 + w * e.n), own: null });
  }

  const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  const shown = scored.filter(x => x.score >= s.min_rides / 2);
  const zones = buildZones(shown, points, b, s);
  const spots = scored
    // Score pondéré par la fraîcheur : une zone qui se vide reste visible, en
    // indigo, jusqu'à la moitié du seuil, puis s'éteint. (L'anonymat est déjà
    // garanti par `pub`, sur les nombres réels.)
    .filter(x => x.score >= s.min_rides / 2)
    .map(x => ({ ...x, center: cellToLatLng(x.id) }))
    .filter(
      x =>
        x.center[0] >= b.minLat && x.center[0] <= b.maxLat && x.center[1] >= b.minLon && x.center[1] <= b.maxLon,
    )
    .sort((a, c) => c.score - a.score)
    .slice(0, MAX_CELLS)
    .map(x => ({
      lat: round(x.center[0], 5),
      lon: round(x.center[1], 5),
      rides: round(x.score, 1),
      fare_km: x.own && x.own.km > 0 ? round(x.own.fare, 2) : null,
      km: x.own && x.own.km > 0 ? round(x.own.km, 2) : null,
      boundary: cellToBoundary(x.id).map(([la, lo]) => [round(la, 5), round(lo, 5)]),
    }));

  const rides = [...pub.values()].reduce((a, c) => a + c.rides, 0);
  return { spots, rides, zones };
}

/**
 * Les cellules affichées qui se touchent forment une zone. Une zone renvoie sa
 * cellule la plus chaude (l'éclair) et les offres scannées dans ses cellules
 * sur la dernière heure. Elle contient au moins une cellule publiable : son
 * total réunit donc toujours plusieurs chauffeurs.
 */
function buildZones(
  shown: { id: string; score: number }[],
  points: Point[],
  b: Bounds,
  s: Settings,
) {
  const byId = new Map(shown.map(x => [x.id, x]));
  const zoneOf = new Map<string, number>();
  const zones: { cells: string[]; peak: { id: string; score: number } }[] = [];
  for (const start of shown) {
    if (zoneOf.has(start.id)) continue;
    const z = { cells: [] as string[], peak: start };
    const queue = [start.id];
    zoneOf.set(start.id, zones.length);
    while (queue.length) {
      const id = queue.pop()!;
      z.cells.push(id);
      const cur = byId.get(id)!;
      if (cur.score > z.peak.score) z.peak = cur;
      for (const nb of gridDisk(id, 1)) {
        if (byId.has(nb) && !zoneOf.has(nb)) {
          zoneOf.set(nb, zones.length);
          queue.push(nb);
        }
      }
    }
    zones.push(z);
  }

  const hour = new Array(zones.length).fill(0);
  for (const p of points) {
    if (p.age > HOUR_MIN) continue;
    const zi = zoneOf.get(latLngToCell(p.lat, p.lon, s.h3_res));
    if (zi !== undefined) hour[zi]++;
  }

  const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  return zones
    .map((z, i) => ({ z, hour: hour[i], at: cellToLatLng(z.peak.id) }))
    .filter(({ at }) => at[0] >= b.minLat && at[0] <= b.maxLat && at[1] >= b.minLon && at[1] <= b.maxLon)
    // Pas d'éclair sur une zone qui s'éteint : seulement là où ça demande encore.
    .filter(({ z, hour: n }) => n >= s.min_rides && z.peak.score >= s.min_rides)
    .sort((a, c) => c.z.peak.score - a.z.peak.score)
    .slice(0, MAX_ZONES)
    .map(({ z, hour: n, at }) => ({
      lat: round(at[0], 5),
      lon: round(at[1], 5),
      rides_hour: n,
      heat: round(z.peak.score, 1),
    }));
}

// ─── Entrée ────────────────────────────────────────────────────────────────

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const uid = await userId(req);
  if (!uid) return json(401, { error: 'not_authenticated' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  const bounds = parseBounds(body);
  if (!bounds) return json(400, { error: 'invalid_bounds' });
  const simulate = body.simulate === true;

  const [{ data: tier }, { data: profile }, { data: set }] = await Promise.all([
    admin.rpc('effective_tier', { p_user: uid }),
    admin.from('profiles').select('is_admin').eq('id', uid).maybeSingle(),
    admin.from('live_map_settings').select('*').eq('id', true).maybeSingle(),
  ]);
  const isAdmin = profile?.is_admin === true;
  if (simulate && !isAdmin) return json(403, { error: 'admin_required' });
  // Un admin qui simule voit le direct même sans Plus : c'est un outil de test.
  if ((tier ?? 'free') === 'free' && !(simulate && isAdmin)) return json(403, { error: 'plus_required' });

  const s: Settings = { ...DEFAULTS, ...(set ?? {}) };
  try {
    const points = simulate ? simulatedPoints(bounds, s) : await realPoints(bounds, s);
    const { spots, rides, zones } = aggregate(points, bounds, s);
    return json(200, {
      spots,
      zones,
      rides,
      minutes: s.window_minutes,
      min_rides: s.min_rides,
      hot_rides: s.hot_rides,
      h3_res: s.h3_res,
      simulated: simulate,
    });
  } catch (e) {
    console.error('community-live', e);
    return json(500, { error: 'internal' });
  }
});
