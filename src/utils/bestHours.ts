import { Ride } from '../types/database';

/**
 * Meilleurs créneaux — quand est-ce que ça sonne, et quand est-ce que ça paie.
 *
 * Deux questions distinctes que le chauffeur mélange souvent : l'heure où son
 * téléphone sonne le plus n'est pas l'heure où il gagne le mieux. Une grille
 * 7 × 24 les sépare, sur son propre historique et non sur une moyenne de ville.
 *
 * ⚠️ Cette lecture n'a de sens que sur une longue période. 168 cases nourries
 * par une semaine de courses, c'est une case sur deux à zéro et l'autre à une
 * course : du bruit présenté comme une recommandation. D'où la fenêtre longue
 * par défaut, et le seuil `MIN_SAMPLE` en dessous duquel un créneau n'est pas
 * proposé comme « meilleur ».
 */

/** Jours en base lundi = 0, pour que la grille se lise comme un planning. */
export const DAYS_IN_WEEK = 7;
export const HOURS_IN_DAY = 24;

/**
 * Nombre de courses en dessous duquel un créneau ne peut pas être recommandé.
 *
 * Sans lui, un mardi 4h du matin où une seule course à 60 €/h est passée
 * remonterait en tête du classement — et enverrait le chauffeur travailler une
 * heure vide sur la foi d'un seul échantillon.
 */
export const MIN_SAMPLE = 3;

export interface HourCell {
  /** Lundi = 0. */
  day: number;
  hour: number;
  /** Courses scannées, acceptées ou non : c'est « ça a sonné ». */
  offers: number;
  accepted: number;
  /** Net cumulé des courses acceptées (carburant déduit). */
  earnings: number;
  /** Minutes cumulées des courses acceptées. */
  minutes: number;
  /** Net rapporté au temps passé, ou null si rien n'a été accepté. */
  hourlyRate: number | null;
}

export interface HourGrid {
  cells: HourCell[];
  /** Bornes utiles au dégradé : les maxima observés sur la grille. */
  maxOffers: number;
  maxHourlyRate: number;
  totalOffers: number;
}

export type SlotMetric = 'offers' | 'hourlyRate';

/**
 * Instant réel du scan.
 *
 * `scan_ts` et non `created_at` : `created_at` est l'heure d'INSERTION, qui
 * peut arriver des heures après le scan quand l'app était fermée ou hors ligne
 * (file d'attente de l'App Group, sync différée). Une course proposée à 3 h et
 * écrite à 9 h atterrirait dans la mauvaise case, et la grille dirait
 * exactement le contraire de la réalité. `created_at` reste le repli pour les
 * courses antérieures à 20260816_rides_scan_ts, qui n'ont pas de `scan_ts`.
 */
function rideDate(ride: Ride): Date {
  return ride.scan_ts != null
    ? new Date(ride.scan_ts * 1000)
    : new Date(ride.created_at);
}

/** JS compte dimanche = 0 ; la grille se lit du lundi au dimanche. */
function mondayFirst(jsDay: number): number {
  return (jsDay + 6) % 7;
}

function emptyCells(): HourCell[] {
  const cells: HourCell[] = [];
  for (let day = 0; day < DAYS_IN_WEEK; day++) {
    for (let hour = 0; hour < HOURS_IN_DAY; hour++) {
      cells.push({
        day,
        hour,
        offers: 0,
        accepted: 0,
        earnings: 0,
        minutes: 0,
        hourlyRate: null,
      });
    }
  }
  return cells;
}

export function cellIndex(day: number, hour: number): number {
  return day * HOURS_IN_DAY + hour;
}

/**
 * Agrège les courses dans la grille 7 × 24.
 *
 * Les courses REFUSÉES comptent dans `offers` et nulle part ailleurs : elles
 * disent que le téléphone a sonné, ce qui est toute la question du volume,
 * mais elles n'ont rapporté ni euro ni minute.
 */
export function buildHourGrid(rides: Ride[]): HourGrid {
  const cells = emptyCells();
  let totalOffers = 0;

  for (const ride of rides) {
    const at = rideDate(ride);
    const time = at.getTime();
    if (Number.isNaN(time)) continue;

    const cell = cells[cellIndex(mondayFirst(at.getDay()), at.getHours())];
    cell.offers += 1;
    totalOffers += 1;

    if (ride.status !== 'ACCEPTED') continue;

    const fare = Number(ride.fare_final ?? ride.fare_estimated) || 0;
    const fuel = Number(ride.fuel_cost ?? 0) || 0;
    const net = ride.net_profit != null ? Number(ride.net_profit) : fare - fuel;

    cell.accepted += 1;
    cell.earnings += net;
    cell.minutes += Number(ride.duration_min) || 0;
  }

  let maxOffers = 0;
  let maxHourlyRate = 0;
  for (const cell of cells) {
    // Le taux horaire se calcule sur le temps RÉELLEMENT passé en course, pas
    // sur l'heure de la case : deux courses de 20 minutes dans le créneau de
    // 18 h ne valent pas une heure de travail, et les diviser par 1 h
    // écraserait le taux de moitié.
    cell.hourlyRate =
      cell.minutes > 0 ? (cell.earnings / cell.minutes) * 60 : null;

    if (cell.offers > maxOffers) maxOffers = cell.offers;
    if (cell.hourlyRate !== null && cell.hourlyRate > maxHourlyRate) {
      maxHourlyRate = cell.hourlyRate;
    }
  }

  return { cells, maxOffers, maxHourlyRate, totalOffers };
}

/**
 * Les meilleurs créneaux selon la métrique choisie.
 *
 * Un créneau sous `MIN_SAMPLE` est écarté, quel que soit son score : un
 * classement fondé sur une seule course n'est pas un classement.
 */
export function topSlots(
  grid: HourGrid,
  metric: SlotMetric,
  count = 3,
): HourCell[] {
  const eligible = grid.cells.filter(c =>
    metric === 'offers' ? c.offers >= MIN_SAMPLE : c.accepted >= MIN_SAMPLE,
  );

  return eligible
    .sort((a, b) => {
      if (metric === 'offers') return b.offers - a.offers;
      return (b.hourlyRate ?? 0) - (a.hourlyRate ?? 0);
    })
    .slice(0, count);
}

/** Valeur d'une case pour la métrique courante, `null` si la case est muette. */
export function metricValue(cell: HourCell, metric: SlotMetric): number | null {
  if (metric === 'offers') return cell.offers > 0 ? cell.offers : null;
  return cell.hourlyRate;
}

/**
 * Intensité de 0 à 1 pour le dégradé de la case.
 *
 * Racine carrée et non proportion directe : la distribution des courses dans la
 * semaine est très piquée (deux ou trois créneaux concentrent tout), et une
 * échelle linéaire rendrait 95 % de la grille uniformément noire — donc
 * illisible. La racine relève les valeurs basses sans inverser l'ordre.
 */
export function intensity(
  value: number | null,
  max: number,
): number {
  if (value === null || max <= 0) return 0;
  return Math.sqrt(Math.max(0, Math.min(value / max, 1)));
}
