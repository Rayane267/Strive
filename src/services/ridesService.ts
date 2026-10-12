import { supabase } from './supabase';
import { Ride } from '../types/database';
import type { LiveSpot, LiveZone } from '../utils/zones';

// Projection explicite (même discipline que PROFILE_COLUMNS) : évite de tirer
// d'éventuelles colonnes serveur hors-type et fige le payload réseau.
const RIDE_COLUMNS =
  'id, user_id, platform, status, fare_estimated, fare_final, distance_km, ' +
  'duration_min, hourly_rate, km_rate, currency, fx_rate_eur, fuel_cost, net_profit, ' +
  'pickup_address, destination_address, scan_ts, created_at';

export async function fetchRides(
  userId: string,
  since: Date,
  options: { limit?: number; currency?: string } = {},
): Promise<Ride[]> {
  let query = supabase
    .from('rides')
    .select(RIDE_COLUMNS)
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });

  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;

  if (error) throw error;
  return (data ?? []) as unknown as Ride[];
}

/**
 * Toutes les courses d'une période, paginées.
 *
 * PostgREST plafonne une réponse à `db-max-rows` (1000 par défaut) et il le
 * fait SANS erreur : une sélection d'un an revenait tronquée et les totaux
 * affichés étaient faux, sans que rien ne le signale. Tant que la sélection
 * était bornée à 7 jours ce plafond restait hors d'atteinte ; il ne l'est plus
 * depuis que Premium peut demander un mois ou une année.
 *
 * Borne haute EXCLUE (`lt`) : `end` est le début de la journée suivante, une
 * course tombant pile dessus appartient au lendemain, pas aux deux.
 *
 * MAX_PAGES borne la boucle — au-delà, mieux vaut un total légèrement court
 * qu'un écran qui pagine sans fin sur un compte anormal.
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 25; // 25 000 courses ≈ 2 ans à 30 scans/jour

export async function fetchRidesInRange(
  userId: string,
  start: Date,
  end: Date,
): Promise<Ride[]> {
  const out: Ride[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('rides')
      .select(RIDE_COLUMNS)
      .eq('user_id', userId)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const rows = (data ?? []) as unknown as Ride[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** Une course réduite à ce que la carte des zones en lit. */
export type RidePoint = {
  pickup_lat: number;
  pickup_lon: number;
  pickup_address: string | null;
  fare_estimated: number;
  fare_final: number | null;
  distance_km: number;
  duration_min: number;
  currency?: string | null;
  fx_rate_eur?: number | null;
};

/**
 * Les départs géolocalisés d'une période, pour la carte.
 *
 * Requête à part plutôt qu'une colonne de plus dans `RIDE_COLUMNS` : si la
 * migration 20261001_ride_coords n'est pas encore passée, seule la carte
 * échoue — l'Historique et les Stats continuent de charger.
 *
 * Toutes les offres scannées comptent, refusées comprises : la carte dit ce
 * qu'une zone PROPOSE, pas seulement ce que le chauffeur y a pris.
 */
export async function fetchRidePoints(
  userId: string,
  start: Date,
  end: Date,
): Promise<RidePoint[]> {
  const out: RidePoint[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('rides')
      .select(
        'pickup_lat, pickup_lon, pickup_address, fare_estimated, fare_final, ' +
          'distance_km, duration_min, currency, fx_rate_eur',
      )
      .eq('user_id', userId)
      .not('pickup_lat', 'is', null)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const rows = (data ?? []) as unknown as RidePoint[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export type CommunityLive = {
  spots: LiveSpot[];
  /** Une entrée par zone : l'éclair et les offres de la dernière heure. */
  zones: LiveZone[];
  /** Offres comptées dans les taches renvoyées. */
  rides: number;
  /** Réglages serveur (table `live_map_settings`), modifiables sans release. */
  minutes: number;
  minRides: number;
  hotRides: number;
};

/**
 * Demande en direct de tous les chauffeurs, en cellules H3 (Edge Function
 * `community-live`, plan Plus vérifié côté serveur). `simulate` : zones
 * inventées autour de la vue, refusé par le serveur hors compte admin.
 */
export async function fetchCommunityLive(
  bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number },
  opts: { simulate?: boolean } = {},
): Promise<CommunityLive> {
  const { data, error } = await supabase.functions.invoke('community-live', {
    body: { ...bounds, simulate: opts.simulate === true },
  });
  if (error) throw error;
  const out = (data ?? {}) as {
    spots?: LiveSpot[];
    zones?: LiveZone[];
    rides?: number;
    minutes?: number;
    min_rides?: number;
    hot_rides?: number;
  };
  return {
    spots: out.spots ?? [],
    zones: out.zones ?? [],
    rides: out.rides ?? 0,
    minutes: out.minutes ?? 30,
    minRides: out.min_rides ?? 3,
    hotRides: out.hot_rides ?? 10,
  };
}

/**
 * Ramene une adresse sur une seule ligne.
 *
 * Les retours ligne viennent du recollage des blocs OCR. Ils n'ont de sens ni
 * pour une valeur stockee, ni pour un geocodage, ni pour un affichage sur une
 * ligne. Les espaces multiples sont ecrases au passage : deux blocs recolles
 * laissent souvent un blanc de chaque cote de la couture.
 */
function oneLineAddress(addr?: string | null): string | null {
  if (!addr) return null;
  const flat = addr.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return flat.length > 0 ? flat : null;
}

/**
 * Colonnes d'un point, ou rien. Les deux valeurs ou aucune : une paire
 * incomplète ferait refuser l'insertion entière par `rides_coords_check`.
 * Rien plutôt que null : un payload sans ces clés reste valide sur une base
 * où la migration 20261001_ride_coords n'est pas encore passée.
 */
function point(
  prefix: 'pickup' | 'dest',
  lat?: number | null,
  lon?: number | null,
): Record<string, number> {
  if (typeof lat !== 'number' || typeof lon !== 'number') return {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return {};
  return { [`${prefix}_lat`]: lat, [`${prefix}_lon`]: lon };
}

export async function createRide(params: {
  userId: string;
  platform: 'UBER' | 'BOLT' | 'HEETCH' | 'UNKNOWN';
  fare: number;
  distanceKm: number;
  durationMin: number;
  hourlyRate: number;
  kmRate: number;
  /**
   * La devise du marché AU MOMENT DU SCAN. Figée ici et jamais recalculée :
   * c'est ce qui permet à un chauffeur qui déménage de garder ses courses
   * françaises en euros au lieu de les voir devenir des livres du jour au
   * lendemain.
   */
  currency: 'EUR' | 'CHF' | 'GBP';
  /**
   * Le taux du jour, figé avec la course. `1` en zone euro.
   *
   * Écrit ici plutôt que relu plus tard : c'est ce qui rend un total passé
   * reproductible. Un relevé qui change tout seul n'est plus un relevé.
   */
  fxRateEur: number;
  fuelCost?: number | null;
  netProfit?: number | null;
  pickupAddress?: string | null;
  destinationAddress?: string | null;
  /** Points déjà arrondis à ~100 m par le natif. Une paire incomplète est
   *  écartée : la contrainte `rides_coords_check` refuserait toute la course. */
  pickupLat?: number | null;
  pickupLon?: number | null;
  destLat?: number | null;
  destLon?: number | null;
  /** Horodatage du scan (epoch secondes). Date la course — jour d'affectation
   *  et registre de quota (`scan_ledger`). N'identifie plus rien. */
  scanTs?: number | null;
  /**
   * Identité frappée par le natif AU SCAN, avant toute écriture. Passée telle
   * quelle en clé primaire : c'est ce qui rend cette fonction idempotente, et
   * ce qui permet aux boutons Prise/Refusée de désigner la course sans jamais
   * avoir à la retrouver.
   *
   * Absent = payload hérité (entrée de journal écrite par un build antérieur) :
   * l'id est alors laissé au serveur, comme avant.
   */
  rideId?: string | null;
  /**
   * `null` quand la course est DÉJÀ en base sous ce même id — c'est-à-dire un
   * rejeu du même scan, ou l'écriture directe faite par le natif au moment du
   * scan. Ce n'est PAS une erreur : l'appelant doit le traiter comme un succès
   * sans rien créer, et acquitter l'entrée du journal natif.
   */
}): Promise<Ride | null> {
  const { data, error } = await supabase
    .from('rides')
    // `upsert` + `ignoreDuplicates` = `on conflict (id) do nothing`. Zéro ligne
    // revient quand l'id existe déjà, ce que `maybeSingle` rend en `null`.
    //
    // Avant, l'identité n'était connue qu'APRÈS l'insertion : il fallait la
    // deviner côté serveur, par un trigger qui écartait tout insert aux chiffres
    // semblables dans une fenêtre de 90 s — et qui refusait donc aussi deux
    // offres réellement distinctes. Il est parti avec
    // 20260821_ride_id_at_scan.sql ; l'index unique sur `scan_ts` reste (voir
    // plus bas, code 23505).
    .upsert({
      ...(params.rideId ? { id: params.rideId } : {}),
      user_id: params.userId,
      platform: params.platform === 'UNKNOWN' ? 'UBER' : params.platform,
      status: 'PENDING',
      fare_estimated: params.fare,
      distance_km: params.distanceKm,
      duration_min: params.durationMin,
      hourly_rate: params.hourlyRate,
      km_rate: params.kmRate,
      currency: params.currency,
      fx_rate_eur: params.fxRateEur,
      fuel_cost: params.fuelCost ?? null,
      net_profit: params.netProfit ?? null,
      // Une adresse tient sur UNE ligne en base.
      //
      // `mergeAddressContinuation` recolle les lignes de continuation avec un
      // retour ligne, et documente lui-meme qu'il faut le convertir en espace.
      // La conversion existe, mais dans `ScanProcessor` et seulement sur le
      // chemin TomTom : quand TomTom est ecarte — cle absente, hors ligne,
      // geocodage refuse — le texte brut arrivait ici avec ses retours ligne.
      pickup_address: oneLineAddress(params.pickupAddress),
      destination_address: oneLineAddress(params.destinationAddress),
      ...point('pickup', params.pickupLat, params.pickupLon),
      ...point('dest', params.destLat, params.destLon),
      // 0 = payload sans scanTs (ancien build encore en file) → on n'écrit pas
      // une clé qui ne corrélera rien.
      scan_ts: params.scanTs ? params.scanTs : null,
      // Heure du SCAN quand on la connaît, pas celle de l'insertion. Une course
      // scannée app fermée n'arrive ici qu'à la réouverture : le défaut `now()`
      // horodaterait toute une matinée de courses « à l'instant », et fausserait
      // aussi bien la liste que les agrégats par jour.
      ...(params.scanTs
        ? { created_at: new Date(params.scanTs * 1000).toISOString() }
        : {}),
    }, { onConflict: 'id', ignoreDuplicates: true })
    .select()
    // `maybeSingle` et pas `single` : sur conflit, zéro ligne revient. `single`
    // répondait PGRST116, que l'appelant prenait pour une panne réseau et
    // remettait la course en file — d'où le doublon recréé plus tard.
    .maybeSingle();

  // 23505 = l'index unique (user_id, scan_ts) a refusé l'insertion. Une course
  // porte déjà ce scan sous un AUTRE id : c'est une entrée de journal héritée,
  // écrite avant que l'id soit frappé au scan, et rejouée depuis. Même
  // sémantique que le conflit d'id — succès sans rien créer. La traiter en
  // panne remettrait la course en file, qui la re-proposerait indéfiniment.
  if (error) {
    if ((error as { code?: string }).code === '23505') return null;
    throw error;
  }
  return (data ?? null) as Ride | null;
}

export async function updateRideStatus(
  id: string,
  status: 'ACCEPTED' | 'DECLINED',
): Promise<void> {
  // `.select()` n'est pas décoratif : sans lui, une mise à jour qui ne touche
  // AUCUNE ligne réussit silencieusement. Supabase ne signale une erreur que sur
  // un échec réel — pas quand la RLS écarte la ligne, quand la session a expiré
  // (`auth.uid()` nul), ou quand l'identifiant ne correspond à rien.
  //
  // L'appelant retirait alors la course de l'écran en croyant avoir enregistré
  // le choix, puis la voyait revenir en PENDING au rafraîchissement suivant.
  // C'est le « des fois ça valide, des fois non » : l'échec existait déjà, il
  // était juste invisible. On le rend explicite pour que le `catch` de
  // `handleStatusUpdate` fasse son travail — retour haptique et resynchro.
  const { data, error } = await supabase
    .from('rides')
    .update({ status })
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`ride_status_update_no_row:${id}`);
  }
}

/**
 * Enregistre le tarif réellement encaissé et recalcule les métriques dérivées.
 *
 * `hourly_rate`, `km_rate` et `net_profit` sont figés au scan à partir du tarif
 * ESTIMÉ. Sans ce recalcul, corriger le montant ne changeait que les gains
 * cumulés (qui passent par effectiveFare) : l'Historique continuait d'afficher
 * les €/h et €/km de l'estimation. `fuel_cost` n'est pas touché — il dépend de
 * la distance et du prix du carburant du jour, pas du tarif.
 */
export async function updateRideFare(
  id: string,
  fare: number,
  metrics?: { distanceKm: number; durationMin: number; fuelCost?: number | null },
): Promise<void> {
  const patch: Record<string, number> = { fare_final: fare };
  if (metrics) {
    if (metrics.durationMin > 0) patch.hourly_rate = fare / (metrics.durationMin / 60);
    if (metrics.distanceKm > 0) patch.km_rate = fare / metrics.distanceKm;
    if (metrics.fuelCost != null) {
      patch.net_profit = Math.round((fare - metrics.fuelCost) * 100) / 100;
    }
  }

  const { error } = await supabase
    .from('rides')
    .update(patch)
    .eq('id', id);

  if (error) throw error;
}

/** Retourne le tarif réel : fare_final si confirmé par le chauffeur, sinon fare_estimated */
export function effectiveFare(ride: { fare_estimated: number; fare_final: number | null }): number {
  return ride.fare_final ?? ride.fare_estimated;
}
