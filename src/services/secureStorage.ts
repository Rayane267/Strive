import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

/**
 * Adapter de stockage chiffré pour la session Supabase (access + refresh token).
 * Backed par le Keychain iOS / Keystore Android (react-native-keychain) au lieu
 * d'AsyncStorage qui stocke en clair. Un item Keychain par clé (service = clé).
 *
 * Migration transparente : si une session vit encore dans l'ancien AsyncStorage
 * (utilisateurs déjà connectés avant ce changement), on la recopie dans le
 * Keychain au 1ᵉ accès puis on purge AsyncStorage → pas de déconnexion forcée.
 *
 * Fallback : si le Keychain est indisponible (rare), on retombe sur AsyncStorage
 * pour ne jamais bloquer l'authentification.
 */
const KEYCHAIN_OPTS = {
  // AFTER_FIRST_UNLOCK : lisible après le 1ᵉ déverrouillage post-boot, y compris
  // quand l'app rafraîchit le token en arrière-plan (écran verrouillé).
  accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
};

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const stored = await Keychain.getGenericPassword({ service: key });
      if (stored) return stored.password;
      // Migration one-shot depuis l'ancien stockage en clair.
      const legacy = await AsyncStorage.getItem(key);
      if (legacy != null) {
        await Keychain.setGenericPassword(key, legacy, { service: key, ...KEYCHAIN_OPTS });
        await AsyncStorage.removeItem(key);
        return legacy;
      }
      return null;
    } catch {
      try { return await AsyncStorage.getItem(key); } catch { return null; }
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await Keychain.setGenericPassword(key, value, { service: key, ...KEYCHAIN_OPTS });
    } catch {
      try { await AsyncStorage.setItem(key, value); } catch {}
    }
  },

  async removeItem(key: string): Promise<void> {
    try { await Keychain.resetGenericPassword({ service: key }); } catch {}
    try { await AsyncStorage.removeItem(key); } catch {}
  },
};
