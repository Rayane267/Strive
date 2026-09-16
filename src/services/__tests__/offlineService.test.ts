jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));

import {
  cacheRides,
  getCachedRides,
  cacheStats,
  getCachedStats,
  cachePreferences,
  getCachedPreferences,
  clearOfflineCache,
  drainLegacyOfflineQueue,
  getLastSyncTime,
} from '../offlineService';

// Mock AsyncStorage
const mockStorage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn((key: string, value: string) => {
    mockStorage[key] = value;
    return Promise.resolve();
  }),
  getItem: jest.fn((key: string) => {
    return Promise.resolve(mockStorage[key] ?? null);
  }),
  removeItem: jest.fn((key: string) => {
    delete mockStorage[key];
    return Promise.resolve();
  }),
  multiRemove: jest.fn((keys: string[]) => {
    keys.forEach(k => delete mockStorage[k]);
    return Promise.resolve();
  }),
}));

beforeEach(() => {
  Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
});

describe('offlineService — rides', () => {
  const mockRides = [
    {
      id: '1',
      user_id: 'u1',
      platform: 'UBER' as const,
      status: 'ACCEPTED' as const,
      fare_estimated: 15.0,
      fare_final: null,
      distance_km: 8.2,
      duration_min: 15,
      hourly_rate: 60,
      km_rate: 1.83,
      created_at: '2026-04-07T10:00:00Z',
    },
  ];

  it('caches and retrieves rides', async () => {
    await cacheRides(mockRides);
    const cached = await getCachedRides();
    expect(cached).toEqual(mockRides);
  });

  it('returns null when no rides cached', async () => {
    const cached = await getCachedRides();
    expect(cached).toBeNull();
  });

  it('records last sync time', async () => {
    await cacheRides(mockRides);
    const syncTime = await getLastSyncTime();
    expect(syncTime).not.toBeNull();
    expect(new Date(syncTime!).getTime()).toBeGreaterThan(0);
  });
});

describe('offlineService — stats', () => {
  const mockStats = {
    totalProfit: 150,
    totalDistance: 80,
    totalDurationMin: 300,
    hourlyRate: 30,
    pricePerKm: 1.87,
    acceptedCount: 12,
    fuelCost: 0,
    appDistribution: { UBER: 60, BOLT: 30, HEETCH: 10 },
    appEarnings: { UBER: 90, BOLT: 45, HEETCH: 15 },
  };

  it('caches and retrieves stats', async () => {
    await cacheStats(mockStats);
    const cached = await getCachedStats();
    expect(cached).toEqual(mockStats);
  });
});

describe('offlineService — preferences', () => {
  it('caches and retrieves preferences', async () => {
    const prefs = { min_hourly_rate: 25, min_km_rate: 1.2, day_reset_hour: 0 };
    await cachePreferences(prefs);
    const cached = await getCachedPreferences();
    expect(cached).toEqual(prefs);
  });
});

// L'ancienne file d'écriture a été remplacée par le journal natif des scans
// (ack explicite). Ne subsiste que la reprise unique de ce qui dormait encore
// dans `@strive_offline_queue` sur les téléphones déjà installés.
//
// Le test supprimé « drops rides after 5 failed retries » encodait précisément
// la perte de données qu'on vient d'éliminer : une course refusée 5 fois était
// effacée. Il n'y a plus de compteur de tentatives, donc plus de suppression.
describe('offlineService — reprise de l\'ancienne file', () => {
  const QUEUE = '@strive_offline_queue';
  const mockRide = {
    user_id: 'u1',
    platform: 'BOLT' as const,
    status: 'PENDING' as const,
    fare_estimated: 12.0,
    fare_final: null,
    distance_km: 5.5,
    duration_min: 10,
    hourly_rate: 72,
    km_rate: 2.18,
    created_at: '2026-04-08T14:00:00Z',
  };

  const seed = (rides: unknown[]) => {
    mockStorage[QUEUE] = JSON.stringify(rides);
  };

  it('remonte les courses et vide la clé quand tout passe', async () => {
    seed([mockRide, { ...mockRide, platform: 'UBER' as const }]);

    const uploadFn = jest.fn().mockResolvedValue(undefined);
    const synced = await drainLegacyOfflineQueue(uploadFn);

    expect(synced).toBe(2);
    expect(uploadFn).toHaveBeenCalledTimes(2);
    expect(mockStorage[QUEUE]).toBeUndefined();
  });

  it('conserve les courses en échec au lieu de les supprimer', async () => {
    seed([mockRide, { ...mockRide, platform: 'UBER' as const }]);

    let callCount = 0;
    const uploadFn = jest.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1
        ? Promise.resolve()
        : Promise.reject(new Error('network error'));
    });

    const synced = await drainLegacyOfflineQueue(uploadFn);

    expect(synced).toBe(1);
    const remaining = JSON.parse(mockStorage[QUEUE]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].platform).toBe('UBER');
  });

  it('ne supprime jamais une course, même après des échecs répétés', async () => {
    seed([mockRide]);
    const alwaysFail = jest.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 10; i++) {
      await drainLegacyOfflineQueue(alwaysFail);
    }

    expect(JSON.parse(mockStorage[QUEUE])).toHaveLength(1);
  });

  it('rend 0 sans rien appeler quand il n\'y a pas d\'ancienne file', async () => {
    const uploadFn = jest.fn();
    const synced = await drainLegacyOfflineQueue(uploadFn);
    expect(synced).toBe(0);
    expect(uploadFn).not.toHaveBeenCalled();
  });
});

describe('offlineService — clearOfflineCache', () => {
  it('clears all cached data', async () => {
    await cacheRides([]);
    await cacheStats({
      totalProfit: 0, totalDistance: 0, totalDurationMin: 0,
      hourlyRate: 0, pricePerKm: 0, acceptedCount: 0, fuelCost: 0,
      appDistribution: { UBER: 0, BOLT: 0, HEETCH: 0 },
      appEarnings: { UBER: 0, BOLT: 0, HEETCH: 0 },
    });
    await clearOfflineCache();
    expect(await getCachedRides()).toBeNull();
    expect(await getCachedStats()).toBeNull();
  });
});
