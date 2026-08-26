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
      fuel_cost: params.fuelCost ?? null,
      net_profit: params.netProfit ?? null,
      pickup_address: params.pickupAddress ?? null,
      destination_address: params.destinationAddress ?? null,
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
