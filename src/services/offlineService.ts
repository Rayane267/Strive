/**
 * Service de cache hors-ligne via AsyncStorage.
 *
 * Cache les données de rides, analytics et préférences pour
 * permettre la consultation sans connexion réseau.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ride } from '../types/database';

const KEYS = {
  RIDES: '@strive_offline_rides',
  STATS: '@strive_offline_stats',
  PREFERENCES: '@strive_offline_prefs',
  LAST_SYNC: '@strive_last_sync',
} as const;

interface CachedStats {
  totalProfit: number;
  totalDistance: number;
  totalDurationMin: number;
  hourlyRate: number;
  pricePerKm: number;
  acceptedCount: number;
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
export async function queueOfflineRide(ride: Omit<Ride, 'id'>): Promise<void> {
  try {
    const QUEUE_KEY = '@strive_offline_queue';
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: Omit<Ride, 'id'>[] = raw ? JSON.parse(raw) : [];
    queue.push(ride);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Silent fail
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

    let synced = 0;
    const failed: Omit<Ride, 'id'>[] = [];

    for (const ride of queue) {
      try {
        await uploadFn(ride);
        synced++;
      } catch {
        failed.push(ride);
      }
    }

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
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
    await AsyncStorage.multiRemove(Object.values(KEYS));
    await AsyncStorage.removeItem('@strive_offline_queue');
  } catch {
    // Silent fail
  }
}
