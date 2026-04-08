import { supabase } from './supabase';
import { Ride } from '../types/database';

export async function fetchRides(userId: string, since: Date): Promise<Ride[]> {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createRide(params: {
  userId: string;
  platform: 'UBER' | 'BOLT' | 'HEETCH' | 'UNKNOWN';
  fare: number;
  distanceKm: number;
  durationMin: number;
  hourlyRate: number;
  kmRate: number;
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

export async function updateRideFare(id: string, fare: number): Promise<void> {
  const { error } = await supabase
    .from('rides')
    .update({ fare_final: fare })
    .eq('id', id);

  if (error) throw error;
}

/** Retourne le tarif réel : fare_final si confirmé par le chauffeur, sinon fare_estimated */
export function effectiveFare(ride: { fare_estimated: number; fare_final: number | null }): number {
  return ride.fare_final ?? ride.fare_estimated;
}
