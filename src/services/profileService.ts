import * as Sentry from '@sentry/react-native';
import { supabase } from './supabase';
import { Profile } from '../types/database';

// Projection explicite : évite d'exfiltrer fcm_token, email_normalized, daily_scans_count,
// last_reset_date, timezone — colonnes serveur non utilisées par l'UI.
const PROFILE_COLUMNS =
  'id, first_name, last_name, email, phone, birth_date, avatar_url, is_online, ' +
  'subscription_tier, subscription_status, subscription_expires_at, ' +
  'subscription_product_id, extra_scan_credits, ' +
  'car_make, car_model, car_year, car_reg, fuel_type, avg_cons, elec_price';

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
 * Met à jour le profile de l'utilisateur courant.
 *
 * On utilise `.update().eq('id', …)` et JAMAIS `.upsert()` : la ligne profiles
 * existe toujours (créée à l'inscription). Un upsert reconstruit un INSERT qui
 * échoue sur les policies RLS INSERT absentes ou les colonnes NOT NULL non
 * fournies — c'était la source d'un bug d'enregistrement côté AccountInfo.
 *
 * Lève l'erreur Supabase telle quelle : c'est à l'appelant d'afficher le
 * message UI et de logguer (code/message/details/hint).
 */
export async function updateProfile(
  userId: string,
  patch: Partial<Omit<Profile, 'id'>>,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId);

  if (error) {
    Sentry.addBreadcrumb({
      category: 'profile',
      message: `updateProfile failed: ${error.message}`,
      level: 'error',
    });
    throw error;
  }
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
