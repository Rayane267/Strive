import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_KEY } from '@env';
import { secureStorage } from './secureStorage';

const supabaseUrl = PUBLIC_SUPABASE_URL;
const supabaseAnonKey = PUBLIC_SUPABASE_KEY;

/**
 * Identifiant d'appareil joint à chaque requête REST, pour le plafond de scans
 * par appareil (`enforce_scan_quota` le lit dans `request.headers`).
 *
 * Posé ici et pas via `global.headers` de `createClient` : il vient du Keychain,
 * donc de façon asynchrone, alors que le client est construit au premier import.
 * Et surtout PAS en important `deviceId.ts` — ce module-là importe `supabase`,
 * l'import serait circulaire et le client vaudrait `undefined` à l'exécution.
 * C'est l'appelant qui pousse la valeur quand il l'a.
 */
let requestDeviceId: string | null = null;

export function setRequestDeviceId(id: string | null) {
  requestDeviceId = id && id.length >= 16 ? id : null;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    // L'en-tête est ajouté à CHAQUE requête plutôt que figé à la construction :
    // il n'est connu qu'après la lecture du Keychain, et une valeur figée serait
    // donc vide sur toutes les requêtes du démarrage — dont l'insertion d'une
    // course scannée app fermée, qui part dès la première synchro.
    fetch: (input, init) => {
      if (!requestDeviceId) return fetch(input, init);
      const headers = new Headers(init?.headers ?? {});
      headers.set('x-device-id', requestDeviceId);
      return fetch(input, { ...init, headers });
    },
  },
  auth: {
    // Session (access + refresh token) stockée chiffrée via Keychain/Keystore.
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Pas besoin de processLock ici pour Expo
  },
});
