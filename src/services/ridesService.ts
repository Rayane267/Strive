import { supabase } from './supabase';
import { Ride } from '../types/database';

// Projection explicite (même discipline que PROFILE_COLUMNS) : évite de tirer
// d'éventuelles colonnes serveur hors-type et fige le payload réseau.
const RIDE_COLUMNS =
  'id, user_id, platform, status, fare_estimated, fare_final, distance_km, ' +
  'duration_min, hourly_rate, km_rate, fuel_cost, net_profit, ' +
  'pickup_address, destination_address, scan_ts, created_at';

export async function fetchRides(
  userId: string,
  since: Date,
  options: { limit?: number } = {},
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

export async function createRide(params: {
  userId: string;
  platform: 'UBER' | 'BOLT' | 'HEETCH' | 'UNKNOWN';
  fare: number;
  distanceKm: number;
  durationMin: number;
  hourlyRate: number;
  kmRate: number;
  fuelCost?: number | null;
  netProfit?: number | null;
  pickupAddress?: string | null;
  destinationAddress?: string | null;
  /**
   * Horodatage du scan (epoch secondes) — clé de corrélation avec les décisions
   * « Prise / Refusée » tapées hors de l'app. Voir `fetchRideIdByScanTs`.
   */
  scanTs?: number | null;
  /**
   * `null` quand le trigger `aa_skip_duplicate_ride` a écarté l'insertion : la
   * course identique a déjà été enregistrée dans les 90 s. Ce n'est PAS une
   * erreur — l'appelant doit traiter ce cas comme un succès sans rien créer.
   */
}): Promise<Ride | null> {
  const { data, error } = await supabase
    .from('rides')
    .insert({
      user_id: params.userId,
      platform: params.platform === 'UNKNOWN' ? 'UBER' : params.platform,
      status: 'PENDING',
      fare_estimated: params.fare,
      distance_km: params.distanceKm,
      duration_min: params.durationMin,
      hourly_rate: params.hourlyRate,
      km_rate: params.kmRate,
      fuel_cost: params.fuelCost ?? null,
      net_profit: params.netProfit ?? null,
      pickup_address: params.pickupAddress ?? null,
      destination_address: params.destinationAddress ?? null,
      // 0 = payload sans scanTs (ancien build encore en file) → on n'écrit pas
      // une clé qui ne corrélera rien.
      scan_ts: params.scanTs ? params.scanTs : null,
      // Heure du SCAN quand on la connaît, pas celle de l'insertion. Une course
      // scannée app fermée n'arrive ici qu'à la réouverture : le défaut `now()`
      // horodatait toute une matinée de courses « à l'instant », et faussait
      // aussi bien la liste que les agrégats par jour.
      ...(params.scanTs
        ? { created_at: new Date(params.scanTs * 1000).toISOString() }
        : {}),
    })
    .select()
    // `maybeSingle` et pas `single` : le trigger anti-doublon annule l'insert
    // en rendant NULL, donc zéro ligne revient. `single` répondait PGRST116,
    // que l'appelant prenait pour une panne réseau et remettait la course en
    // file offline — d'où le doublon recréé plus tard, hors fenêtre de 90 s.
    .maybeSingle();

  // 23505 = l'index unique (user_id, scan_ts) a refusé l'insertion : la course
  // est DÉJÀ en base — écrite par le process de scan lui-même, ou par un rejeu
  // antérieur de la file. Même sémantique que le trigger anti-doublon : succès
  // sans rien créer. La traiter en panne remettrait la course en file offline,
  // qui la re-proposerait indéfiniment.
  if (error) {
    if ((error as { code?: string }).code === '23505') return null;
    throw error;
  }
  return (data ?? null) as Ride | null;
}

/**
 * Retrouve la course d'un scan par sa clé exacte. Sert aux décisions
 * « Prise / Refusée » tapées hors de l'app : le process qui les émet ne connaît
 * que `scanTs`, et le mapping mémoire du Dashboard est perdu dès que le JS
 * redémarre. Interroger la base est alors la seule façon de retrouver la course
 * — la corrélation sur `created_at` échouait dès que l'insertion avait eu lieu
 * plus de 3 minutes après le scan, ce qui est le cas normal d'un scan app fermée.
 *
 * Renvoie `null` si aucune course ne porte ce scan (course jamais enregistrée,
 * ou antérieure à la migration qui a introduit la colonne).
 */
export async function fetchRideIdByScanTs(
  userId: string,
  scanTs: number,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('rides')
    .select('id')
    .eq('user_id', userId)
    .eq('scan_ts', scanTs)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

export async function updateRideStatus(
  id: string,
  status: 'ACCEPTED' | 'DECLINED',
): Promise<void> {
  const { error } = await supabase
    .from('rides')
    .update({ status })
    .eq('id', id);

  if (error) throw error;
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
