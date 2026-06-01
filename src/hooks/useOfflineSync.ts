/**
 * Hook qui synchronise les rides en queue offline vers Supabase.
 * Déclencheurs :
 *  - retour de connexion réseau (après une période offline)
 *  - démarrage/foreground de l'app (AppState actif)
 *  - appel manuel via `flush()` retourné (ex: après un scan réussi)
 */

import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { useNetworkStatus } from './useNetworkStatus';
import { syncOfflineQueue } from '../services/offlineService';
import { createRide } from '../services/ridesService';
import { useAuth } from '../context/AuthContext';

export function useOfflineSync() {
  const { isConnected } = useNetworkStatus();
  const { user } = useAuth();
  const syncingRef = useRef(false);
  const wasOfflineRef = useRef(false);

  const flush = useCallback(async () => {
    if (!user || syncingRef.current) return;
    syncingRef.current = true;
    try {
      const count = await syncOfflineQueue(async (ride) => {
        await createRide({
          userId: user.id,
          platform: ride.platform,
          fare: ride.fare_estimated,
          distanceKm: ride.distance_km,
          durationMin: ride.duration_min,
          hourlyRate: ride.hourly_rate,
          kmRate: ride.km_rate,
          pickupAddress: ride.pickup_address,
          destinationAddress: ride.destination_address,
        });
      });
      if (count > 0) __DEV__ && console.log(`[SYNC] ${count} ride(s) synced from offline queue`);
    } catch (err) {
      Sentry.captureException(err, { tags: { flow: 'offline_sync' } });
    } finally {
      syncingRef.current = false;
    }
  }, [user]);

  // Trigger 1 : retour de connexion après offline
  useEffect(() => {
    if (!isConnected) { wasOfflineRef.current = true; return; }
    if (!wasOfflineRef.current || !user) return;
    wasOfflineRef.current = false;
    flush();
  }, [isConnected, user, flush]);

  // Trigger 2 : démarrage initial + retour foreground
  useEffect(() => {
    if (!user || !isConnected) return;
    flush();  // au mount
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') flush();
    });
    return () => sub.remove();
  }, [user, isConnected, flush]);

  return flush;
}
