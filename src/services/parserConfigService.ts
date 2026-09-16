import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { supabase } from './supabase';

const CACHE_KEY = '@strive_parser_config';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry {
  /** `null` = la table ne contient pas de config. Mémorisé comme un vrai
   *  résultat : sans ça le cache ne se remplissait qu'en cas de succès, et une
   *  table vide relançait une requête réseau à CHAQUE montage du Dashboard
   *  (1 062 lectures observées en base pour 0 ligne). */
  configJson: string | null;
  timestamp: number;
}

/**
 * Récupère la config de parsing VTC depuis Supabase avec cache 24h.
 * Retourne null si inaccessible (utilise les valeurs par défaut du Kotlin).
 */
export async function fetchParserConfig(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const entry: CacheEntry = JSON.parse(raw);
      if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
        return entry.configJson;
      }
    }

    const { data, error } = await supabase
      .from('parser_config')
      .select('config')
      .limit(1)
      .single();

    // PGRST116 = aucune ligne : ce n'est pas une panne, c'est une réponse. On la
    // met en cache comme les autres, sinon on réinterroge indéfiniment.
    // Une VRAIE erreur (réseau, permissions) n'est pas mise en cache : on veut
    // réessayer au prochain montage plutôt que de rester 24 h sur un échec.
    if (error || !data) {
      const isEmpty = !error || error.code === 'PGRST116';
      if (error && !isEmpty) {
        Sentry.addBreadcrumb({ category: 'parser', message: `fetchParserConfig failed: ${error.message}`, level: 'warning' });
        return null;
      }
      const empty: CacheEntry = { configJson: null, timestamp: Date.now() };
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(empty));
      return null;
    }

    const configJson = JSON.stringify(data.config);
    const entry: CacheEntry = { configJson, timestamp: Date.now() };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(entry));

    return configJson;
  } catch {
    return null;
  }
}
