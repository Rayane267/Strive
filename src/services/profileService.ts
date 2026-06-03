import * as Sentry from '@sentry/react-native';
import { supabase } from './supabase';
import { Profile } from '../types/database';

// Projection explicite : évite d'exfiltrer fcm_token, email_normalized, daily_scans_count,
// last_reset_date, timezone — colonnes serveur non utilisées par l'UI.
const PROFILE_COLUMNS =
  'id, first_name, last_name, email, phone, birth_date, avatar_url, is_online, ' +
  'subscription_tier, subscription_status, subscription_expires_at, ' +
  'subscription_product_id, extra_scan_credits, ' +
  'car_make, car_model, car_year, car_reg, fuel_type, avg_cons';

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single();

  if (error) {
    Sentry.addBreadcrumb({ category: 'profile', message: `fetchProfile failed: ${error.message}`, level: 'error' });
    return null;
  }
  return data as unknown as Profile;
}

/**
 * Poll le profile jusqu'à ce que `predicate` retourne true ou timeout.
 * Utile après un achat IAP : on attend que le webhook RC ait propagé l'update
 * en DB plutôt que de sleep aveuglément.
 */
export async function waitForProfileUpdate(
  userId: string,
  predicate: (p: Profile) => boolean,
  options: { maxWaitMs?: number; intervalMs?: number } = {},
): Promise<Profile | null> {
  const { maxWaitMs = 6000, intervalMs = 600 } = options;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const profile = await fetchProfile(userId);
    if (profile && predicate(profile)) return profile;
    await new Promise<void>(r => setTimeout(r, intervalMs));
  }
  return null;
}
