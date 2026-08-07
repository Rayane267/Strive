import { supabase } from './supabase';
import { Ride } from '../types/database';

// Projection explicite (même discipline que PROFILE_COLUMNS) : évite de tirer
// d'éventuelles colonnes serveur hors-type et fige le payload réseau.
const RIDE_COLUMNS =
  'id, user_id, platform, status, fare_estimated, fare_final, distance_km, ' +
  'duration_min, hourly_rate, km_rate, fuel_cost, net_profit, ' +
  'pickup_address, destination_address, created_at';

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
}): Promise<Ride> {
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
    })
    .select()
    .single();

  if (error) throw error;
  return data as Ride;
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
