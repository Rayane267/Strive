/**
 * Service de cache hors-ligne via AsyncStorage.
 *
 * Cache les données de rides, analytics et préférences pour
 * permettre la consultation sans connexion réseau.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { Ride } from '../types/database';

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

// ─── File d'écriture (SUPPRIMÉE) ────────────────────────────────────────────────
//
// `queueOfflineRide` / `syncOfflineQueue` n'existent plus. Les courses qui
// n'atteignent pas Supabase restent désormais dans le JOURNAL NATIF des scans
// (App Group iOS / SharedPreferences Android), retiré entrée par entrée via
// `scannerService.ackScan(rideId)` une fois l'écriture confirmée.
//
// Pourquoi cette file a disparu :
//   • elle supprimait la course au bout de 5 tentatives — un refus permanent
//     (quota dépassé) épuisait le compteur et détruisait la donnée ;
//   • elle rejouait des courses sans la date du scan, qui atterrissaient au
//     mauvais jour ;
//   • second chemin d'écriture en parallèle du chemin natif, d'où des doublons
//     et un verrou anti-concurrence pour les contenir.
//
// Ce fichier ne garde que le cache de LECTURE (consultation hors-ligne).

const LEGACY_QUEUE_KEY = '@strive_offline_queue';
const LEGACY_RETRY_KEY = '@strive_offline_retries';

/**
 * Reprise unique de l'ancienne file : sur les téléphones déjà installés, des
 * courses y dorment encore. Sans ce drain elles seraient orphelines pour
 * toujours. Chaque course est renvoyée ; celles qui passent sont retirées, les
 * autres restent pour la prochaine tentative — jamais supprimées.
 *
 * À retirer une fois le parc migré (quelques semaines après la mise en ligne).
 */
export async function drainLegacyOfflineQueue(
  uploadFn: (ride: Omit<Ride, 'id'>) => Promise<void>,
): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_QUEUE_KEY);
    if (!raw) return 0;
    const queue: Omit<Ride, 'id'>[] = JSON.parse(raw);
    if (queue.length === 0) {
      await AsyncStorage.multiRemove([LEGACY_QUEUE_KEY, LEGACY_RETRY_KEY]);
      return 0;
    }

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

    if (failed.length === 0) {
      await AsyncStorage.multiRemove([LEGACY_QUEUE_KEY, LEGACY_RETRY_KEY]);
    } else {
      await AsyncStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(failed));
    }
    if (synced > 0) {
      Sentry.addBreadcrumb({
        category: 'offline',
        message: `Legacy queue: ${synced} ride(s) recovered, ${failed.length} remaining`,
        level: 'info',
      });
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
    await AsyncStorage.multiRemove([
      ...Object.values(KEYS),
      LEGACY_QUEUE_KEY,
      LEGACY_RETRY_KEY,
      CACHE_VERSION_KEY,
    ]);
    _versionChecked = false;
  } catch {
    // Silent fail
  }
}
