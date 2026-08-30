import * as Sentry from '@sentry/react-native';
import { supabase } from './supabase';
import { Profile } from '../types/database';

// Projection explicite : évite d'exfiltrer fcm_token, email_normalized,
// last_reset_date, timezone — colonnes serveur non utilisées par l'UI.
const PROFILE_COLUMNS =
  'id, first_name, last_name, email, phone, birth_date, avatar_url, is_online, ' +
  'subscription_tier, subscription_status, subscription_expires_at, ' +
  'subscription_product_id, extra_scan_credits, ' +
  // Pool de bienvenue. Sans ces deux colonnes ici, `getWelcomeCredits()` lit
  // `undefined` et rend 0 : le solde offert n'apparaît jamais et le paywall
  // d'épuisement ne part jamais. La projection étant explicite, ajouter un
  // champ au type TypeScript ne suffit pas — il faut le demander.
  'welcome_credits, welcome_credits_expires_at, ' +
  // Réservé aux comptes staff : ouvre l'écran Diagnostic sur un build de
  // production, où `__DEV__` est faux.
  'is_admin, ' +
  // Le quota tel que le serveur l'applique. En lecture seule (le trigger
  // `check_scan_quota` en est le seul écrivain) : l'exposer ne risque rien et
  // évite au client de recalculer un substitut à partir des courses.
  'daily_scans_count, daily_scans_day, ' +
  'car_make, car_model, car_year, car_reg, fuel_type, avg_cons, elec_price';

/**
 * Trois issues, et il faut les distinguer — les confondre a enfermé des comptes.
 *
 *   • `{ profile }`  — la ligne existe.
 *   • `{ missing }`  — la requête a abouti, il n'y a PAS de ligne. État normal
 *                      (compte tout juste créé) ou signe que le compte a été
 *                      supprimé côté serveur alors que la session vit encore.
 *   • `{ error }`    — vrai échec : réseau, RLS, colonne absente. Réessayer a
 *                      un sens.
 *
 * `maybeSingle()` et non `single()` : ce dernier traite « zéro ligne » comme une
 * erreur, ce qui rendait les deux derniers cas indiscernables. L'appelant posait
 * alors l'écran « Impossible de charger votre profil » avec un bouton Réessayer
 * qui ne pouvait rien réparer — et comme la session est stockée dans le Keychain
 * (voir `secureStorage`), qui SURVIT à la désinstallation, la boucle ne se
 * cassait ni en redémarrant, ni en réinstallant l'app.
 */
export type FetchProfileResult =
  | { profile: Profile }
  | { missing: true }
  | { error: string };

export async function fetchProfileResult(userId: string): Promise<FetchProfileResult> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    Sentry.addBreadcrumb({ category: 'profile', message: `fetchProfile failed: ${error.message}`, level: 'error' });
    return { error: error.message };
  }
  if (!data) {
    Sentry.addBreadcrumb({ category: 'profile', message: 'fetchProfile: aucune ligne', level: 'warning' });
    return { missing: true };
  }
  return { profile: data as unknown as Profile };
}

/** Conservé pour les appelants qui n'ont besoin que du profil ou de rien. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const res = await fetchProfileResult(userId);
  return 'profile' in res ? res.profile : null;
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
