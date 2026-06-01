/**
 * TomTom Routing Service
 *
 * Utilise deux APIs TomTom :
 *  1. Search / Geocoding  → adresse texte → coordonnées GPS
 *  2. Routing             → coords départ + arrivée → durée réelle en voiture
 *
 * Clé configurée dans .env : TOMTOM_API_KEY
 */

import * as Sentry from '@sentry/react-native';
import { TOMTOM_API_KEY } from '@env';

const BASE_SEARCH  = 'https://api.tomtom.com/search/2/geocode';
const BASE_ROUTING = 'https://api.tomtom.com/routing/1/calculateRoute';

interface Coords { lat: number; lon: number }
interface GeocodeResult { coords: Coords; score: number }

const API_TIMEOUT_MS = 10_000;
// Seuil de confiance TomTom au-delà duquel on considère le géocodage fiable.
// En dessous on essaie une adresse candidate (ligne voisine OCR).
const MIN_CONFIDENCE = 5;
// Pays EU cible (expansion Strive) — FR, BE, CH, LU + UK, DE, ES, IT, NL, PT,
// AT, IE, PL. Permet le géocodage sans ré-interroger par pays.
const COUNTRY_SET = 'FR,BE,CH,LU,GB,DE,ES,IT,NL,PT,AT,IE,PL';

function fetchWithTimeout(url: string, ms = API_TIMEOUT_MS): Promise<Response> {
  // AbortController : annule réellement la requête en cours plutôt que de la
  // laisser fuiter (sockets + bande passante + quota TomTom).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { method: 'GET', signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

async function geocodeWithScore(address: string): Promise<GeocodeResult | null> {
  if (!address || !TOMTOM_API_KEY) return null;
  try {
    const encoded = encodeURIComponent(address);
    const url = `${BASE_SEARCH}/${encoded}.json?key=${TOMTOM_API_KEY}&language=fr-FR&countrySet=${COUNTRY_SET}&limit=1`;
    __DEV__ && console.log('[TomTom:geocode] →', address);
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      __DEV__ && console.warn('[TomTom:geocode] HTTP', res.status, 'pour', address);
      return null;
    }
    const json = await res.json();
    const first = json?.results?.[0];
    const pos = first?.position;
    if (!pos?.lat || !pos?.lon) {
      __DEV__ && console.warn('[TomTom:geocode] pas de résultat pour', address);
      return null;
    }
    const score = typeof first?.score === 'number' ? first.score : 0;
    __DEV__ && console.log(`[TomTom:geocode] ← ${address} | score=${score.toFixed(2)}`);
    return { coords: { lat: pos.lat, lon: pos.lon }, score };
  } catch (e) {
    __DEV__ && console.warn('[TomTom:geocode] exception pour', address, e);
    return null;
  }
}

/**
 * Géocode en essayant plusieurs candidats — retourne le résultat avec le
 * meilleur score. Permet de récupérer quand l'OCR coupe une adresse mais que
 * les lignes voisines (continuation) donnent la bonne forme.
 */
async function geocodeBest(candidates: string[]): Promise<GeocodeResult | null> {
  const uniqueCandidates = Array.from(new Set(candidates.filter(c => c && c.trim())));
  if (uniqueCandidates.length === 0) return null;

  let best: GeocodeResult | null = null;
  for (const candidate of uniqueCandidates) {
    const result = await geocodeWithScore(candidate);
    if (!result) continue;
    if (!best || result.score > best.score) best = result;
    // Early exit si on a déjà un score élevé
    if (best.score >= MIN_CONFIDENCE + 2) return best;
  }
  return best;
}

async function geocode(address: string): Promise<Coords | null> {
  const result = await geocodeWithScore(address);
  if (!result) return null;
  if (__DEV__ && result.score < MIN_CONFIDENCE) {
    console.warn('[TomTom] géocodage à faible confiance', { address, score: result.score });
  }
  return result.coords;
}

// ─── Routing ──────────────────────────────────────────────────────────────────

interface RouteSummary { durationMin: number; distanceKm: number }

async function getRouteSummary(from: Coords, to: Coords): Promise<RouteSummary | null> {
  if (!TOMTOM_API_KEY) return null;
  try {
    const waypoints = `${from.lat},${from.lon}:${to.lat},${to.lon}`;
    // traffic=true + departAt=now → trafic temps réel (flux live + incidents)
    // pris en compte à l'instant du calcul ; routeType=fastest → meilleur trajet.
    const url = `${BASE_ROUTING}/${waypoints}/json?key=${TOMTOM_API_KEY}&travelMode=car&traffic=true&routeType=fastest&departAt=now`;
    __DEV__ && console.log('[TomTom:route] → appel routing');
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      __DEV__ && console.warn('[TomTom:route] HTTP', res.status);
      return null;
    }
    const json = await res.json();
    const seconds = json?.routes?.[0]?.summary?.travelTimeInSeconds;
    const meters  = json?.routes?.[0]?.summary?.lengthInMeters;
    if (!seconds || !meters) {
      __DEV__ && console.warn('[TomTom:route] pas de route');
      return null;
    }
    return {
      durationMin: Math.round(seconds / 60),
      distanceKm: Math.round(meters / 100) / 10,
    };
  } catch (e) {
    __DEV__ && console.warn('[TomTom:route] exception', e);
    return null;
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Calcule la durée + la distance du trajet entre deux adresses textuelles.
 * Accepte des candidats alternatifs par extrémité (ex: lignes OCR voisines)
 * et garde le géocodage au meilleur score de confiance TomTom.
 * Retourne null si la clé est absente, les adresses invalides ou le réseau indisponible.
 */
export async function calculateRoute(
  pickupAddress: string,
  destinationAddress: string,
  pickupFallbacks: string[] = [],
  destinationFallbacks: string[] = [],
): Promise<RouteSummary | null> {
  if (!TOMTOM_API_KEY) {
    __DEV__ && console.warn('[TomTom] TOMTOM_API_KEY not set');
    return null;
  }

  const [from, to] = await Promise.all([
    geocodeBest([pickupAddress, ...pickupFallbacks]),
    geocodeBest([destinationAddress, ...destinationFallbacks]),
  ]);

  if (!from || !to) {
    Sentry.addBreadcrumb({ category: 'tomtom', message: 'Geocode failed', data: { pickupAddress, destinationAddress }, level: 'warning' });
    __DEV__ && console.warn('[TomTom] geocode failed', { pickupAddress, destinationAddress, from, to });
    return null;
  }

  __DEV__ && console.log('[TomTom] géocodage', { pickupScore: from.score, destScore: to.score });
  const summary = await getRouteSummary(from.coords, to.coords);
  __DEV__ && console.log('[TomTom] route:', summary);
  return summary;
}

/**
 * Compat : retourne uniquement la durée (utilise calculateRoute en interne).
 * @deprecated Utilise calculateRoute pour obtenir aussi la distance.
 */
export async function calculateRouteDuration(
  pickupAddress: string,
  destinationAddress: string,
): Promise<number | null> {
  return (await calculateRoute(pickupAddress, destinationAddress))?.durationMin ?? null;
}
