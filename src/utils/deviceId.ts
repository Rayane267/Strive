/**
 * Device ID stable utilisé pour anti-multi-comptes.
 *
 * Génère un UUID v4 au 1er lancement de l'app et le stocke dans AsyncStorage.
 * Persiste tant que l'utilisateur ne désinstalle pas l'app.
 *
 * Limite connue : un user qui désinstalle/réinstalle obtient un nouveau UUID.
 * Pour persistance plus dure, utiliser DeviceInfo.getUniqueId() côté natif (ANDROID_ID
 * sur Android, identifierForVendor sur iOS), mais ça nécessite une lib de plus.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';

const DEVICE_ID_KEY = '@strive_device_id';

function uuidV4(): string {
  // RFC 4122 v4 sans dépendance externe (Math.random suffit pour notre usage)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Récupère l'UUID stable du device. Génère + stocke au 1er appel. */
export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.length >= 16) return existing;
    const fresh = uuidV4();
    await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Si AsyncStorage est cassé, on génère un volatile (pire UX mais pas crash)
    return uuidV4();
  }
}

/**
 * Appelle la RPC Supabase register_device_signup. À appeler IMMÉDIATEMENT
 * après une session Supabase nouvellement établie (signup ou 1er login).
 *
 * Si le device a déjà été utilisé pour créer un compte, le serveur restreint
 * automatiquement le free tier de ce nouveau compte (audit_log + extra_credits=0).
 */
export async function registerDeviceSignup(): Promise<{ multiAccount: boolean }> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const { data, error } = await supabase.rpc('register_device_signup', {
      p_device_id: deviceId,
    });
    if (error) {
      __DEV__ && console.warn('[deviceId] register failed', error);
      return { multiAccount: false };
    }
    return { multiAccount: !!(data as any)?.multi_account };
  } catch (e) {
    __DEV__ && console.warn('[deviceId] exception', e);
    return { multiAccount: false };
  }
}
