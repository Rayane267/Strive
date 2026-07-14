import { Ride } from '../types/database';

/**
 * Score qualité des courses, 100 % basé sur les vraies courses loggées et les
 * seuils du chauffeur (min €/h + min €/km). On recalcule le verdict depuis
 * fare/durée/distance (comme `weeklyTease`) plutôt que de faire confiance aux
 * colonnes hourly_rate/km_rate, pour rester cohérent quel que soit l'historique.
 *
 *  - quality    : sur les courses ACCEPTÉES, moyenne du verdict (vert=2, orange=1,
 *                 rouge=0) ramenée sur 100. « Est-ce que je prends du bon ? »
 *  - discipline : sur les décisions tranchées (accepter un vert / refuser un rouge),
 *                 part de bonnes décisions. « Est-ce que je trie bien ? » L'orange
 *                 est exclu (jugement légitime dans les deux sens).
 */

const effectiveFare = (r: Ride): number =>
  r.fare_final != null ? r.fare_final : r.fare_estimated;

/** Verdict 0/1/2 d'une course, ou null si la donnée ne permet pas de trancher. */
function rideVerdict(r: Ride, minHourlyRate: number, minKmRate: number): 0 | 1 | 2 | null {
  const fare = effectiveFare(r);
  const hours = r.duration_min > 0 ? r.duration_min / 60 : 0;
  const km = r.distance_km > 0 ? r.distance_km : 0;
  if (hours <= 0 && km <= 0) return null;

  const hrOk = hours > 0 ? fare / hours >= minHourlyRate : true;
  const kmOk = km > 0 ? fare / km >= minKmRate : true;
  return hrOk && kmOk ? 2 : hrOk || kmOk ? 1 : 0;
}

/**
 * Score d'une course individuelle sur 100, basé sur les taux €/h et €/km stockés
 * (ceux affichés sur la carte) rapportés aux seuils du chauffeur. Atteindre
 * exactement ses seuils ≈ 71 ; les dépasser de 40 % ou plus → 100.
 * Retourne null si aucun taux exploitable.
 */
export function computeRideScore(
  hourlyRate: number,
  kmRate: number,
  minHourlyRate: number,
  minKmRate: number,
): number | null {
  const parts: number[] = [];
  if (hourlyRate > 0 && minHourlyRate > 0) parts.push(hourlyRate / minHourlyRate);
  if (kmRate > 0 && minKmRate > 0) parts.push(kmRate / minKmRate);
  if (parts.length === 0) return null;

  // ratio 1.0 (pile le seuil) → ~71 ; ratio ≥ 1.4 → 100.
  const CAP = 1.4;
  const mapped = parts.map(r => Math.min(1, r / CAP));
  const avg = mapped.reduce((a, b) => a + b, 0) / mapped.length;
  return Math.round(avg * 100);
}

/** Couleur d'un score /100, alignée sur le code vert/orange/rouge de l'app. */
export function rideScoreColor(score: number): string {
  if (score >= 70) return '#00E676';
  if (score >= 45) return '#FF9800';
  return '#FF5252';
}

export interface QualityScore {
  quality: number | null;        // 0-100 sur les acceptées, null si échantillon vide
  discipline: number | null;     // 0-100 sur les décisions tranchées, null si vide
  qualitySample: number;         // nb de courses acceptées prises en compte
  disciplineSample: number;      // nb de décisions tranchées prises en compte
  greenCount: number;            // acceptées vertes
  missedCount: number;           // vertes refusées (manque à gagner potentiel)
}

export function computeQualityScore(
  rides: Ride[],
  minHourlyRate: number,
  minKmRate: number,
): QualityScore {
  let verdictSum = 0;
  let qualitySample = 0;
  let good = 0;
  let bad = 0;
  let greenCount = 0;
  let missedCount = 0;

  for (const r of rides) {
    const v = rideVerdict(r, minHourlyRate, minKmRate);
    if (v == null) continue;

    if (r.status === 'ACCEPTED') {
      verdictSum += v;
      qualitySample += 1;
      if (v === 2) { good += 1; greenCount += 1; }
      else if (v === 0) { bad += 1; }
    } else if (r.status === 'DECLINED') {
      if (v === 0) good += 1;
      else if (v === 2) { bad += 1; missedCount += 1; }
    }
  }

  const disciplineSample = good + bad;
  return {
    quality: qualitySample > 0 ? Math.round((verdictSum / (qualitySample * 2)) * 100) : null,
    discipline: disciplineSample > 0 ? Math.round((good / disciplineSample) * 100) : null,
    qualitySample,
    disciplineSample,
    greenCount,
    missedCount,
  };
}
