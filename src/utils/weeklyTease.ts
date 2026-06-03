import { Ride } from '../types/database';

/**
 * Calcul du « tease de perte hebdo » (aversion à la perte → conversion Plus).
 * 100 % basé sur les vraies courses loggées — aucun chiffre inventé.
 *
 *  - state 'loss'  : manque à gagner significatif sur les courses ACCEPTÉES
 *                    sous l'objectif horaire → on projette en mensuel + ancre.
 *  - state 'pride' : pas de perte mais des courses pourries REFUSÉES → on
 *                    valorise (le produit a déjà servi).
 *  - state 'none'  : données trop minces → la carte est masquée (jamais de 0 €).
 */

export interface WeeklyTease {
  state: 'loss' | 'pride' | 'none';
  lossWeek: number;   // € sous l'objectif cette semaine (courses acceptées)
  lossMonth: number;  // projection mensuelle (~×4.3)
  avoided: number;    // nb de courses pourries refusées
}

// Seuil d'affichage : en dessous, le chiffre n'est pas assez parlant.
const LOSS_MIN_EUR = 10;
const WEEKS_PER_MONTH = 4.3;

const effectiveFare = (r: Ride): number =>
  r.fare_final != null ? r.fare_final : r.fare_estimated;

/**
 * Chiffres bruts du bilan hebdo (sans seuil de conversion) — pour l'affichage
 * insight dans Stats (Plus). `lossWeek` = manque à gagner vs objectif horaire sur
 * les courses acceptées ; `avoided` = courses non rentables refusées.
 */
export function computeWeeklyBilan(
  rides: Ride[],
  minHourlyRate: number,
  minKmRate: number,
): { lossWeek: number; avoided: number } {
  let lossWeek = 0;
  let avoided = 0;

  for (const r of rides) {
    const fare = effectiveFare(r);
    const hours = r.duration_min > 0 ? r.duration_min / 60 : 0;
    const belowHourly = hours > 0 && fare / hours < minHourlyRate;
    const belowKm = r.distance_km > 0 && fare / r.distance_km < minKmRate;

    if (r.status === 'ACCEPTED' && belowHourly) {
      // Manque à gagner = écart à TON objectif horaire sur une course que tu as prise.
      lossWeek += Math.max(0, minHourlyRate * hours - fare);
    } else if (r.status === 'DECLINED' && (belowHourly || belowKm)) {
      avoided += 1;
    }
  }

  return { lossWeek, avoided };
}

export function computeWeeklyTease(
  rides: Ride[],
  minHourlyRate: number,
  minKmRate: number,
): WeeklyTease {
  const { lossWeek, avoided } = computeWeeklyBilan(rides, minHourlyRate, minKmRate);
  const lossMonth = lossWeek * WEEKS_PER_MONTH;

  if (lossWeek >= LOSS_MIN_EUR) {
    return { state: 'loss', lossWeek, lossMonth, avoided };
  }
  if (avoided >= 1) {
    return { state: 'pride', lossWeek: 0, lossMonth: 0, avoided };
  }
  return { state: 'none', lossWeek: 0, lossMonth: 0, avoided: 0 };
}
