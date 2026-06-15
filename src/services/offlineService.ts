/**
 * Service de cache hors-ligne via AsyncStorage.
 *
 * Cache les données de rides, analytics et préférences pour
 * permettre la consultation sans connexion réseau.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { Ride } from '../types/database';
import { notifySyncDropped } from './localNotifications';

const CACHE_VERSION = 1;
const CACHE_VERSION_KEY = '@strive_cache_version';

const KEYS = {
  RIDES: '@strive_offline_rides',
  STATS: '@strive_offline_stats',
  PREFERENCES: '@strive_offline_prefs',
  LAST_SYNC: '@strive_last_sync',
} as const;

/**
 * Vérifie la version du cache. Si elle ne correspond pas,
 * efface tout le cache pour éviter les erreurs de parsing.
 */
async function ensureCacheVersion(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(CACHE_VERSION_KEY);
    if (stored === null) {
      // First run — just set version, no data to clear
      await AsyncStorage.setItem(CACHE_VERSION_KEY, String(CACHE_VERSION));
    } else if (stored !== String(CACHE_VERSION)) {
      // Version changed — clear stale cache
      await AsyncStorage.multiRemove(Object.values(KEYS));
      await AsyncStorage.setItem(CACHE_VERSION_KEY, String(CACHE_VERSION));
    }
  } catch {
    // Silent fail
  }
}

let _versionChecked = false;

interface CachedStats {
  totalProfit: number;
  totalDistance: number;
  totalDurationMin: number;
  hourlyRate: number;
  pricePerKm: number;
  acceptedCount: number;
  fuelCost: number;
  appDistribution: { UBER: number; BOLT: number; HEETCH: number };
  appEarnings: { UBER: number; BOLT: number; HEETCH: number };
}

interface CachedPreferences {
  min_hourly_rate: number;
  min_km_rate: number;
  day_reset_hour: number;
}

// ─── Rides ──────────────────────────────────────────────────────────────────────

export async function cacheRides(rides: Ride[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.RIDES, JSON.stringify(rides));
    await AsyncStorage.setItem(KEYS.LAST_SYNC, new Date().toISOString());
  } catch {
    // Silent fail — cache is best-effort
  }
}

export async function getCachedRides(): Promise<Ride[] | null> {
  try {
    if (!_versionChecked) { await ensureCacheVersion(); _versionChecked = true; }
    const raw = await AsyncStorage.getItem(KEYS.RIDES);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ─── Stats ──────────────────────────────────────────────────────────────────────

export async function cacheStats(stats: CachedStats): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.STATS, JSON.stringify(stats));
  } catch {
    // Silent fail
  }
}

export async function getCachedStats(): Promise<CachedStats | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.STATS);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ─── Preferences ────────────────────────────────────────────────────────────────

export async function cachePreferences(prefs: CachedPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.PREFERENCES, JSON.stringify(prefs));
  } catch {
    // Silent fail
  }
}

export async function getCachedPreferences(): Promise<CachedPreferences | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PREFERENCES);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ─── Sync info ──────────────────────────────────────────────────────────────────

export async function getLastSyncTime(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEYS.LAST_SYNC);
  } catch {
    return null;
  }
}

/**
 * Queue une ride créée hors-ligne pour sync ultérieur.
 * Les rides sont ajoutées au cache local et marquées pour upload.
 */
const MAX_QUEUE_SIZE = 100;
const MAX_RETRY_COUNT = 5;
const RETRY_KEY = '@strive_offline_retries';

export async function queueOfflineRide(ride: Omit<Ride, 'id'>): Promise<void> {
  try {
    const QUEUE_KEY = '@strive_offline_queue';
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: Omit<Ride, 'id'>[] = raw ? JSON.parse(raw) : [];
    if (queue.length >= MAX_QUEUE_SIZE) {
      Sentry.addBreadcrumb({ category: 'offline', message: `Queue full (${MAX_QUEUE_SIZE}), dropping oldest`, level: 'warning' });
      queue.shift();
    }
    queue.push(ride);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Silent fail — cache is best-effort
  }
}

/**
 * Synchronise les rides en queue vers Supabase.
 * Retourne le nombre de rides synchronisées.
 */
export async function syncOfflineQueue(
  uploadFn: (ride: Omit<Ride, 'id'>) => Promise<void>,
): Promise<number> {
  const QUEUE_KEY = '@strive_offline_queue';
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return 0;

    const queue: Omit<Ride, 'id'>[] = JSON.parse(raw);
    if (queue.length === 0) return 0;

    // Load retry counts
    const retryRaw = await AsyncStorage.getItem(RETRY_KEY);
    const retries: Record<number, number> = retryRaw ? JSON.parse(retryRaw) : {};

    let synced = 0;
    let dropped = 0;
    const failed: Omit<Ride, 'id'>[] = [];
    const newRetries: Record<number, number> = {};

    for (let i = 0; i < queue.length; i++) {
      const ride = queue[i];
      const retryCount = retries[i] ?? 0;

      // Drop rides that failed too many times
      if (retryCount >= MAX_RETRY_COUNT) {
        dropped++;
        Sentry.captureMessage(`Offline ride dropped after ${MAX_RETRY_COUNT} retries`, {
          level: 'warning',
          tags: { flow: 'offline_sync' },
          extra: { platform: ride.platform, fare: ride.fare_estimated },
        });
        continue;
      }

      try {
        await uploadFn(ride);
        synced++;
      } catch {
        // L'index ré-écrit doit correspondre à la position de la ride dans le
        // tableau `failed` (qui devient le nouveau `queue`), pas à `failed.length`
        // au moment du push (qui pointe sur l'élément suivant).
        const newIndex = failed.length;
        failed.push(ride);
        newRetries[newIndex] = retryCount + 1;
      }
    }

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
    await AsyncStorage.setItem(RETRY_KEY, JSON.stringify(newRetries));

    if (synced > 0) {
      Sentry.addBreadcrumb({ category: 'offline', message: `Synced ${synced} ride(s), ${failed.length} remaining`, level: 'info' });
    }

    // L'utilisateur doit savoir que des revenus manquent — sinon il découvre
    // des courses absentes de ses stats sans explication.
    if (dropped > 0) {
      notifySyncDropped(dropped);
    }

    return synced;
  } catch {
    return 0;
  }
}

/**
 * Efface tout le cache hors-ligne.
 */
export async function clearOfflineCache(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...Object.values(KEYS), '@strive_offline_queue', RETRY_KEY, CACHE_VERSION_KEY]);
    _versionChecked = false;
  } catch {
    // Silent fail
  }
}
