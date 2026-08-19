/**
 * Reprise de l'ANCIENNE file d'écriture AsyncStorage.
 *
 * Les courses en attente d'écriture vivent désormais dans le journal natif des
 * scans, rejoué par le natif à chaque retour au premier plan et purgé par
 * `ackScan`. Ce hook ne sert plus qu'à récupérer ce qui dormait encore dans
 * `@strive_offline_queue` sur les téléphones déjà installés.
 *
 * À supprimer une fois le parc migré.
 *
 * Déclencheurs :
 *  - retour de connexion réseau (après une période offline)
 *  - démarrage/foreground de l'app (AppState actif)
 */

import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { useNetworkStatus } from './useNetworkStatus';
import { drainLegacyOfflineQueue } from '../services/offlineService';
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
      const count = await drainLegacyOfflineQueue(async (ride) => {
        await createRide({
          userId: user.id,
          platform: ride.platform,
          fare: ride.fare_estimated,
          distanceKm: ride.distance_km,
          durationMin: ride.duration_min,
          hourlyRate: ride.hourly_rate,
          kmRate: ride.km_rate,
          // Ces trois champs étaient omis : une course reprise perdait son coût
          // carburant, son net, et surtout sa clé de scan — donc sa date, que
          // `createRide` dérive de `scanTs`. Elle atterrissait au jour de la
          // reprise au lieu du jour du scan.
          fuelCost: ride.fuel_cost,
          netProfit: ride.net_profit,
          scanTs: ride.scan_ts ?? null,
          pickupAddress: ride.pickup_address,
          destinationAddress: ride.destination_address,
        });
      });
      if (count > 0) __DEV__ && console.log(`[SYNC] ${count} ride(s) récupérée(s) de l'ancienne file`);
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
