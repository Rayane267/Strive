/**
 * Device ID stable — stocké dans le Keychain iOS / Keystore Android.
 * Persiste même après désinstallation de l'app, contrairement à AsyncStorage.
 * Utilisé pour les quotas anti-multi-comptes (email + OAuth).
 */

import * as Keychain from 'react-native-keychain';
import { supabase } from '../services/supabase';

const KEYCHAIN_SERVICE = 'com.striveapp.deviceId';
const KEYCHAIN_OAUTH_SERVICE = 'com.striveapp.oauthSignups';

function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (existing && existing.password.length >= 16) return existing.password;
    const fresh = uuidV4();
    await Keychain.setGenericPassword('deviceId', fresh, { service: KEYCHAIN_SERVICE });
    return fresh;
  } catch {
    return uuidV4();
  }
}

/**
 * Quota email : appeler AVANT `supabase.auth.signUp()`. Vérifie côté
 * serveur (RPC) si le device a déjà créé 5+ comptes en 60 jours.
 */
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

/**
 * Quota OAuth (Apple / Google) : max 3 créations de compte par device
 * par fenêtre rolling de 60 jours. Stocké dans le Keychain — persiste
 * après désinstallation.
 *
 * Barrière locale, doublée côté serveur par enforceSignupQuota (table
 * device_signups). Mêmes seuil et fenêtre des deux côtés : un écart ferait
 * qu'une des deux barrières bloquerait seule, et le diagnostic deviendrait
 * illisible.
 *
 * Appelée APRÈS `signInWithIdToken` uniquement si le user vient d'être
 * créé (created_at < 60s). Les logins existants ne sont jamais bloqués.
 */
export async function enforceOAuthSignupQuota(): Promise<void> {
  const signups = await readOAuthSignups();
  const windowStart = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const recent = signups.filter(ts => ts > windowStart);
  if (recent.length >= 3) {
    throw new Error('device_signup_limit_reached');
  }
}

export async function registerOAuthSignup(): Promise<void> {
  const signups = await readOAuthSignups();
  signups.push(Date.now());
  const windowStart = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const cleaned = signups.filter(ts => ts > windowStart);
  await Keychain.setGenericPassword('oauthSignups', JSON.stringify(cleaned), {
    service: KEYCHAIN_OAUTH_SERVICE,
  });
}

async function readOAuthSignups(): Promise<number[]> {
  try {
    const result = await Keychain.getGenericPassword({ service: KEYCHAIN_OAUTH_SERVICE });
    if (result) return JSON.parse(result.password);
  } catch {}
  return [];
}
