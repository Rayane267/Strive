import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ZonePoint } from '../utils/zones';

/**
 * Zones chaudes simulées — outil admin (écran Diagnostics).
 *
 * Allumé : le direct demande à l'Edge Function `community-live` des offres
 * inventées autour de la vue, qui passent par le même calcul H3 que les vraies
 * (le serveur vérifie `is_admin`) ; « Mes courses » affiche un mois de courses
 * inventées, générées ici. Rien n'est écrit en base : les autres chauffeurs ne
 * voient jamais ces zones.
 */

const KEY = '@strive_admin_sim_hot_zones';

export async function isHotZoneSimulationOn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setHotZoneSimulation(on: boolean): Promise<void> {
  if (on) await AsyncStorage.setItem(KEY, '1');
  else await AsyncStorage.removeItem(KEY);
}

/** Générateur à graine : les mêmes fausses courses pour un même endroit. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Un mois de courses inventées autour de `center`, pour l'onglet « Mes
 * courses » : 4 à 6 quartiers, chacun rentable, moyen ou mauvais, de quoi voir
 * des zones vertes, orange et rouges. Purement local, rien n'est enregistré.
 */
export function simulateRidePoints(center: { latitude: number; longitude: number }): ZonePoint[] {
  const seed = Math.abs(Math.round(center.latitude * 50) * 7919 + Math.round(center.longitude * 50)) + 1;
  const rand = rng(seed);
  const cosLat = Math.max(0.1, Math.cos((center.latitude * Math.PI) / 180));
  const out: ZonePoint[] = [];
  const hoods = 4 + Math.floor(rand() * 3);
  for (let h = 0; h < hoods; h++) {
    // Un quartier à 1–6 km du centre de la vue.
    const ang = rand() * Math.PI * 2;
    const distKm = 1 + rand() * 5;
    const hLat = center.latitude + (Math.sin(ang) * distKm) / 111.32;
    const hLon = center.longitude + (Math.cos(ang) * distKm) / (111.32 * cosLat);
    // Rentable, moyen ou mauvais, en €/km.
    const kind = h % 3;
    const kmRate = kind === 0 ? 1.9 + rand() * 0.5 : kind === 1 ? 1.25 + rand() * 0.25 : 0.6 + rand() * 0.25;
    // Un mauvais quartier est aussi un quartier lent : le €/h y chute avec le €/km.
    const [vMin, vMax] = kind === 0 ? [26, 36] : kind === 1 ? [20, 27] : [12, 18];
    const rides = 8 + Math.floor(rand() * 22);
    for (let i = 0; i < rides; i++) {
      const km = 3 + rand() * 12;
      const speed = vMin + rand() * (vMax - vMin); // km/h moyen, trafic compris
      out.push({
        lat: hLat + ((rand() - 0.5) * 1.6) / 111.32,
        lon: hLon + ((rand() - 0.5) * 1.6) / (111.32 * cosLat),
        fare: Math.round(km * kmRate * 100) / 100,
        distanceKm: Math.round(km * 10) / 10,
        durationMin: Math.round((km / speed) * 60),
        address: null,
      });
    }
  }
  return out;
}
