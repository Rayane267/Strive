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
  queueOfflineRide,
  syncOfflineQueue,
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

describe('offlineService — offline queue', () => {
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

  it('queues a ride for offline sync', async () => {
    await queueOfflineRide(mockRide);
    const raw = mockStorage['@strive_offline_queue'];
    const queue = JSON.parse(raw);
    expect(queue).toHaveLength(1);
    expect(queue[0].platform).toBe('BOLT');
  });

  it('queues multiple rides', async () => {
    await queueOfflineRide(mockRide);
    await queueOfflineRide({ ...mockRide, platform: 'UBER' as const });
    const raw = mockStorage['@strive_offline_queue'];
    const queue = JSON.parse(raw);
    expect(queue).toHaveLength(2);
  });

  it('syncs queued rides successfully', async () => {
    await queueOfflineRide(mockRide);
    await queueOfflineRide({ ...mockRide, platform: 'UBER' as const });

    const uploadFn = jest.fn().mockResolvedValue(undefined);
    const synced = await syncOfflineQueue(uploadFn);

    expect(synced).toBe(2);
    expect(uploadFn).toHaveBeenCalledTimes(2);
    // Queue should be empty
    const raw = mockStorage['@strive_offline_queue'];
    expect(JSON.parse(raw)).toHaveLength(0);
  });

  it('keeps failed rides in queue', async () => {
    await queueOfflineRide(mockRide);
    await queueOfflineRide({ ...mockRide, platform: 'UBER' as const });

    let callCount = 0;
    const uploadFn = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve();
      return Promise.reject(new Error('network error'));
    });

    const synced = await syncOfflineQueue(uploadFn);

    expect(synced).toBe(1);
    const raw = mockStorage['@strive_offline_queue'];
    const remaining = JSON.parse(raw);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].platform).toBe('UBER');
  });

  it('returns 0 when queue is empty', async () => {
    const uploadFn = jest.fn();
    const synced = await syncOfflineQueue(uploadFn);
    expect(synced).toBe(0);
    expect(uploadFn).not.toHaveBeenCalled();
  });

  it('caps queue at 100 rides, dropping oldest', async () => {
    // Fill queue to 100
    for (let i = 0; i < 100; i++) {
      await queueOfflineRide({ ...mockRide, fare_estimated: i });
    }
    const rawBefore = mockStorage['@strive_offline_queue'];
    expect(JSON.parse(rawBefore)).toHaveLength(100);

    // Add one more — should drop the oldest (fare_estimated: 0)
    await queueOfflineRide({ ...mockRide, fare_estimated: 999 });
    const rawAfter = mockStorage['@strive_offline_queue'];
    const queue = JSON.parse(rawAfter);
    expect(queue).toHaveLength(100);
    expect(queue[0].fare_estimated).toBe(1); // oldest (0) was dropped
    expect(queue[99].fare_estimated).toBe(999);
  });

  it('drops rides after 5 failed retries', async () => {
    await queueOfflineRide(mockRide);

    const alwaysFail = jest.fn().mockRejectedValue(new Error('fail'));

    // Simulate 5 sync attempts that all fail
    for (let i = 0; i < 5; i++) {
      await syncOfflineQueue(alwaysFail);
    }

    // 6th attempt: ride should be dropped (not retried)
    alwaysFail.mockClear();
    const synced = await syncOfflineQueue(alwaysFail);
    expect(synced).toBe(0);
    expect(alwaysFail).not.toHaveBeenCalled();

    // Queue should be empty
    const raw = mockStorage['@strive_offline_queue'];
    expect(JSON.parse(raw)).toHaveLength(0);
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
