import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { supabase } from './supabase';

const CACHE_KEY = '@strive_parser_config';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry {
  configJson: string;
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

    if (error || !data) {
      if (error) Sentry.addBreadcrumb({ category: 'parser', message: `fetchParserConfig failed: ${error.message}`, level: 'warning' });
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
