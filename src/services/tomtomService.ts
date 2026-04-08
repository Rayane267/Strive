/**
 * TomTom Routing Service
 *
 * Utilise deux APIs TomTom :
 *  1. Search / Geocoding  → adresse texte → coordonnées GPS
 *  2. Routing             → coords départ + arrivée → durée réelle en voiture
 *
 * Clé configurée dans .env : TOMTOM_API_KEY
 */

import { TOMTOM_API_KEY } from '@env';

const BASE_SEARCH  = 'https://api.tomtom.com/search/2/geocode';
const BASE_ROUTING = 'https://api.tomtom.com/routing/1/calculateRoute';

interface Coords { lat: number; lon: number }

// ─── Geocoding ────────────────────────────────────────────────────────────────

async function geocode(address: string): Promise<Coords | null> {
  if (!address || !TOMTOM_API_KEY) return null;
  try {
    const encoded = encodeURIComponent(address);
    const url = `${BASE_SEARCH}/${encoded}.json?key=${TOMTOM_API_KEY}&language=fr-FR&countrySet=FR,BE,CH,LU&limit=1`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const json = await res.json();
    const pos = json?.results?.[0]?.position;
    if (!pos?.lat || !pos?.lon) return null;
    return { lat: pos.lat, lon: pos.lon };
  } catch {
    return null;
  }
}

// ─── Routing ──────────────────────────────────────────────────────────────────

async function getRouteDurationMin(from: Coords, to: Coords): Promise<number | null> {
  if (!TOMTOM_API_KEY) return null;
  try {
    const waypoints = `${from.lat},${from.lon}:${to.lat},${to.lon}`;
    const url = `${BASE_ROUTING}/${waypoints}/json?key=${TOMTOM_API_KEY}&travelMode=car&traffic=true`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const json = await res.json();
    const seconds = json?.routes?.[0]?.summary?.travelTimeInSeconds;
    if (!seconds) return null;
    return Math.round(seconds / 60);
  } catch {
    return null;
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Calcule la durée de trajet entre deux adresses textuelles.
 * Retourne null si la clé est absente, les adresses invalides ou le réseau indisponible.
 */
export async function calculateRouteDuration(
  pickupAddress: string,
  destinationAddress: string,
): Promise<number | null> {
  if (!TOMTOM_API_KEY) {
    __DEV__ && console.warn('[TomTom] TOMTOM_API_KEY not set');
    return null;
  }

  const [from, to] = await Promise.all([
    geocode(pickupAddress),
    geocode(destinationAddress),
  ]);

  if (!from || !to) {
    __DEV__ && console.warn('[TomTom] geocode failed', { pickupAddress, destinationAddress, from, to });
    return null;
  }

  const minutes = await getRouteDurationMin(from, to);
  __DEV__ && console.log('[TomTom] route duration:', minutes, 'min');
  return minutes;
}
