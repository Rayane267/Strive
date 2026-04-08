/**
 * Hook qui synchronise automatiquement les rides en queue
 * quand la connexion réseau revient.
 */

import { useEffect, useRef } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { syncOfflineQueue } from '../services/offlineService';
import { createRide } from '../services/ridesService';
import { useAuth } from '../context/AuthContext';

export function useOfflineSync() {
  const { isConnected } = useNetworkStatus();
  const { user } = useAuth();
  const syncingRef = useRef(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!isConnected) {
      wasOfflineRef.current = true;
      return;
    }

    if (!wasOfflineRef.current || !user || syncingRef.current) return;

    wasOfflineRef.current = false;
    syncingRef.current = true;

    syncOfflineQueue(async (ride) => {
      await createRide({
        userId: user.id,
        platform: ride.platform,
        fare: ride.fare_estimated,
        distanceKm: ride.distance_km,
        durationMin: ride.duration_min,
        hourlyRate: ride.hourly_rate,
        kmRate: ride.km_rate,
      });
    })
      .then((count) => {
        if (count > 0) {
          __DEV__ && console.log(`[SYNC] ${count} ride(s) synced from offline queue`);
        }
      })
      .catch(() => {})
      .finally(() => {
        syncingRef.current = false;
      });
  }, [isConnected, user]);
}
