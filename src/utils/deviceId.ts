/**
 * Device ID stable utilisé pour quota anti-multi-comptes au SIGNUP uniquement.
 * Au login, le device_id n'est plus utilisé — un user existant ne sera donc
 * jamais bloqué par cette mécanique.
 *
 * Politique côté serveur : 5 signups max par device sur une fenêtre rolling
 * de 60 jours. Au-delà → erreur claire affichée à l'utilisateur.
 *
 * Limite connue : désinstaller l'app vide l'AsyncStorage → nouveau UUID au
 * prochain lancement → quota reset. Accepté : on dissuade, on n'empêche pas
 * absolument. Les protections complémentaires (confirm email, normalize,
 * disposable blocklist, cooldown 60s) couvrent les flux résiduels.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';

const DEVICE_ID_KEY = '@strive_device_id';
const OAUTH_SIGNUPS_KEY = '@strive_oauth_signups';

function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.length >= 16) return existing;
    const fresh = uuidV4();
    await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    return uuidV4();
  }
}

/**
 * À appeler AVANT `supabase.auth.signUp()`. Throw une erreur typée si le
 * device a déjà créé 5+ comptes dans les 60 derniers jours. Le caller affiche
 * alors un message clair et N'envoie PAS la requête signUp.
 *
 * Politique fail-closed : si la RPC échoue (réseau, DB down…), on bloque le
 * signup. Si Supabase est inaccessible, le signUp suivant échouerait de toute
 * façon — on évite ainsi un contournement du quota anti-spam par DoS DB.
 *
 * Types d'erreurs (via err.message) :
 *   - 'device_signup_limit_reached'  : quota dépassé
 *   - 'invalid_device_id'            : device_id < 16 chars
 *   - 'signup_quota_check_failed'    : RPC injoignable (réseau, Supabase down)
 */
/**
 * Quota OAuth (Apple / Google) : max 5 créations de compte par device par
 * fenêtre rolling de 30 jours. Compteur local AsyncStorage — reset si
 * l'app est désinstallée (acceptable, même limite que le device_id email).
 *
 * Appelée APRÈS `signInWithIdToken` uniquement si le user vient d'être
 * créé (created_at < 60s). Les logins sur un compte existant ne sont
 * jamais bloqués.
 */
export async function enforceOAuthSignupQuota(): Promise<void> {
  const raw = await AsyncStorage.getItem(OAUTH_SIGNUPS_KEY);
  const signups: number[] = raw ? JSON.parse(raw) : [];
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = signups.filter(ts => ts > thirtyDaysAgo);
  if (recent.length >= 5) {
    throw new Error('device_signup_limit_reached');
  }
}

export async function registerOAuthSignup(): Promise<void> {
  const raw = await AsyncStorage.getItem(OAUTH_SIGNUPS_KEY);
  const signups: number[] = raw ? JSON.parse(raw) : [];
  signups.push(Date.now());
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const cleaned = signups.filter(ts => ts > thirtyDaysAgo);
  await AsyncStorage.setItem(OAUTH_SIGNUPS_KEY, JSON.stringify(cleaned));
}

export async function enforceSignupQuota(): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  const { error } = await supabase.rpc('check_and_register_device_signup', {
    p_device_id: deviceId,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('device_signup_limit_reached') || msg.includes('invalid_device_id')) {
      throw new Error('device_signup_limit_reached');
    }
    throw new Error('signup_quota_check_failed');
  }
}
