import { cellToBoundary, cellToLatLng, latLngToCell } from 'h3-js';

import { computeRideScore } from './qualityScore';

/**
 * Carte des zones — où les courses paient.
 *
 * Les départs sont regroupés sur la grille H3 d'Uber, en résolution 7 : des
 * hexagones d'environ 2 km de large, chacun l'équivalent de 7 cases de la
 * carte en direct (résolution 8). À 1 km, une zone ne réunissait que deux ou
 * trois courses et la carte s'émiettait en petites cases. La grille est FIXE :
 * une zone reste le même morceau de ville quel que soit le zoom, et son contour
 * est l'hexagone H3 exact.
 *
 * h3-js tourne sur l'appareil (patches/h3-js : Hermes refuse le décodeur
 * UTF-16 que la bibliothèque crée au chargement).
 */

/** Résolution H3 des zones de « Mes courses » (le direct est en 8). */
export const H3_RES = 7;
/** Écart entre les centres de deux hexagones voisins à cette résolution, en
 *  mètres : sert à savoir si l'étiquette tient dans la case à l'écran. */
export const H3_SPACING_M = 2100;

export type LatLng = { latitude: number; longitude: number };

export type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };

export type ZonePoint = {
  lat: number;
  lon: number;
  /** Déjà dans la devise du chauffeur : la conversion se fait en amont. */
  fare: number;
  distanceKm: number;
  durationMin: number;
  address: string | null;
};

export type Zone = {
  key: string;
  corners: LatLng[];
  center: LatLng;
  rides: number;
  hourlyRate: number | null;
  kmRate: number | null;
  /** Score /100 contre les seuils du chauffeur — la même échelle que les cartes
   *  de l'Historique, donc les mêmes couleurs. */
  score: number | null;
  /** « 75008 Paris », tiré des adresses de départ de la zone. */
  label: string | null;
};

/**
 * Nombre de courses à partir duquel une zone prend sa couleur pleine.
 *
 * En dessous elle reste pâle : une zone d'une seule course à 60 €/h est une
 * anecdote, pas un endroit où aller attendre. La pâleur le dit sans la cacher.
 */
export const FULL_CONFIDENCE = 5;

/** Au-delà, on garde les zones les plus fournies : des milliers de polygones
 *  ralentissent la carte sans rien montrer de plus à l'œil. */
const MAX_ZONES = 600;

// Code postal à 4 ou 5 chiffres (FR, BE, CH, ES ; 4-3 au Portugal) suivi de
// la ville. Le Royaume-Uni passe par le repli sur la virgule.
const POSTCODE_CITY = /\b(\d{4,5}(?:-\d{3})?)\s+([^\d,]+)/;

/** « 12 Rue de Rivoli, 75004 Paris » → « 75004 Paris ». */
export function zoneLabel(address: string | null): string | null {
  if (!address) return null;
  const m = address.match(POSTCODE_CITY);
  if (m) return `${m[1]} ${m[2].trim()}`;
  const comma = address.indexOf(',');
  const rest = comma >= 0 ? address.slice(comma + 1).trim() : '';
  return rest || null;
}

type Cell = {
  rides: number;
  fareWithKm: number;
  km: number;
  fareWithTime: number;
  hours: number;
  labels: Map<string, number>;
};

/**
 * Regroupe les départs par cellule H3 (résolution `H3_RES`).
 *
 * €/h et €/km sont des RAPPORTS DE SOMMES, pas des moyennes de taux : une
 * course de 80 € sur 40 km pèse plus qu'une de 8 € sur 2 km, comme dans le
 * portefeuille du chauffeur. Chaque rapport n'additionne que les courses qui
 * portent son dénominateur.
 */
export function buildZones(
  points: ZonePoint[],
  thresholds: { minHourly: number; minKm: number },
): Zone[] {
  const cells = new Map<string, Cell>();

  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const key = latLngToCell(p.lat, p.lon, H3_RES);
    let c = cells.get(key);
    if (!c) {
      c = { rides: 0, fareWithKm: 0, km: 0, fareWithTime: 0, hours: 0, labels: new Map() };
      cells.set(key, c);
    }
    c.rides += 1;
    if (p.distanceKm > 0) {
      c.fareWithKm += p.fare;
      c.km += p.distanceKm;
    }
    if (p.durationMin > 0) {
      c.fareWithTime += p.fare;
      c.hours += p.durationMin / 60;
    }
    const label = zoneLabel(p.address);
    if (label) c.labels.set(label, (c.labels.get(label) ?? 0) + 1);
  }

  const zones: Zone[] = [];
  cells.forEach((c, key) => {
    const corners: LatLng[] = cellToBoundary(key).map(([lat, lon]) => ({ latitude: lat, longitude: lon }));
    const [clat, clon] = cellToLatLng(key);
    const hourlyRate = c.hours > 0 ? c.fareWithTime / c.hours : null;
    const kmRate = c.km > 0 ? c.fareWithKm / c.km : null;
    let label: string | null = null;
    let best = 0;
    for (const [l, n] of c.labels) {
      if (n > best) {
        best = n;
        label = l;
      }
    }
    zones.push({
      key,
      corners,
      center: { latitude: clat, longitude: clon },
      rides: c.rides,
      hourlyRate,
      kmRate,
      score: computeRideScore(hourlyRate ?? 0, kmRate ?? 0, thresholds.minHourly, thresholds.minKm),
      label,
    });
  });
  return zones;
}

/** Une tache de demande en direct, renvoyée par `community_live`. */
export type LiveSpot = {
  lat: number;
  lon: number;
  /** Offres scannées dans la fenêtre. */
  rides: number;
  /** Sommes en euros, au taux du scan. */
  fare_km: number | null;
  km: number | null;
  /** Contour de la cellule H3, en [lat, lon]. */
  boundary?: [number, number][];
};

/** Une zone en direct (cellules contiguës), renvoyée par `community-live` :
 *  l'éclair se pose sur sa cellule la plus chaude. */
export type LiveZone = {
  lat: number;
  lon: number;
  /** Offres scannées dans la zone sur la dernière heure. */
  rides_hour: number;
  /** Score de la cellule la plus chaude. */
  heat: number;
};

/**
 * Les zones à dessiner pour la région affichée : celles de l'écran plus une
 * demi-largeur de marge, pour qu'un petit déplacement ne fasse pas apparaître
 * de cases après coup.
 */
export function zonesInView(zones: Zone[], region: Region): Zone[] {
  const hLat = region.latitudeDelta;
  const hLon = region.longitudeDelta;
  const inView = zones.filter(
    z =>
      Math.abs(z.center.latitude - region.latitude) <= hLat &&
      Math.abs(z.center.longitude - region.longitude) <= hLon,
  );
  if (inView.length <= MAX_ZONES) return inView;
  return [...inView].sort((a, b) => b.rides - a.rides).slice(0, MAX_ZONES);
}

/** Demi-côté minimal du cadre d'ouverture (~2 km) : une poignée de points
 *  proches ne doit pas zoomer jusqu'à la rue. */
const MIN_HALF_SPAN = 0.01;

/**
 * Le cadre à montrer à l'ouverture : là où le chauffeur roule.
 *
 * Les 5 % de points les plus excentrés sont écartés : une course isolée à
 * Lille ne doit pas dézoomer une carte qui vit à Paris.
 */
export function framingBounds(points: ZonePoint[]): [LatLng, LatLng] | null {
  if (points.length === 0) return null;
  const lats = points.map(p => p.lat).sort((a, b) => a - b);
  const lons = points.map(p => p.lon).sort((a, b) => a - b);
  const trim = points.length >= 20 ? 0.05 : 0;
  const at = (arr: number[], q: number) => arr[Math.round(q * (arr.length - 1))];
  const [lat0, lat1] = [at(lats, trim), at(lats, 1 - trim)];
  const [lon0, lon1] = [at(lons, trim), at(lons, 1 - trim)];
  const cLat = (lat0 + lat1) / 2;
  const cLon = (lon0 + lon1) / 2;
  const hLat = Math.max((lat1 - lat0) / 2, MIN_HALF_SPAN);
  const hLon = Math.max((lon1 - lon0) / 2, MIN_HALF_SPAN);
  return [
    { latitude: cLat - hLat, longitude: cLon - hLon },
    { latitude: cLat + hLat, longitude: cLon + hLon },
  ];
}
