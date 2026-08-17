/**
 * Dérivation du seuil de rentabilité à partir de l'objectif du chauffeur.
 *
 * Demander « ton minimum €/h ? » sur un curseur de 10 à 80 € est une question à
 * laquelle personne ne sait répondre. « Combien tu veux gagner » et « combien
 * d'heures tu roules » sont immédiats — et suffisent à calculer le premier.
 */

import { FREE_THRESHOLDS } from '../services/subscriptionService';

/** Semaines moyennes par mois (52 / 12). */
export const WEEKS_PER_MONTH = 4.33;

/**
 * Échelle €/h → €/km. Le kilométrique NE SE DÉRIVE PAS de l'objectif : il
 * faudrait connaître la vitesse moyenne du chauffeur, inconnue à l'onboarding.
 * On le cale donc sur les paliers du tutoriel (Débutant / Standard / Exigeant).
 * Doit rester aligné avec PRESETS dans TutorialScreen.
 */
const KM_SCALE: ReadonlyArray<{ hourly: number; km: number }> = [
  { hourly: 25, km: 1.10 },
  { hourly: 32, km: 1.35 },
  { hourly: 42, km: 1.70 },
];

/**
 * Taux de charges sociales par statut — part du chiffre d'affaires qui part
 * avant que le chauffeur ne touche quoi que ce soit.
 *
 * Ce sont des ordres de grandeur, pas des barèmes : la vraie valeur dépend du
 * régime fiscal, de l'ACRE, du versement libératoire… D'où l'option `autre`,
 * qui laisse saisir son taux réel.
 *
 * `salarie` est à 0 : un chauffeur employé ne reverse rien lui-même, son
 * objectif net se compare directement au chiffre d'affaires qu'il génère.
 */
export const SOCIAL_RATES = {
  auto_entrepreneur: 0.22,
  societe: 0.45,
  salarie: 0,
} as const;

export type DriverStatus = keyof typeof SOCIAL_RATES | 'autre';

export type GoalInput = {
  /** Revenu NET mensuel visé, en euros. */
  monthlyGoal: number;
  /** Heures travaillées par semaine. */
  weeklyHours: number;
  /** Charges fixes mensuelles (LOA, assurance…), en euros. */
  fixedCosts: number;
  /** Part du CA reversée en charges sociales (0,22 = 22 %). */
  socialRate: number;
};

export type DerivedThreshold = {
  /** Seuil horaire retenu, plancher de rentabilité appliqué. */
  hourly: number;
  /** Seuil kilométrique correspondant sur l'échelle. */
  km: number;
  /** Ce que l'objectif seul exigeait, avant plancher. */
  rawHourly: number;
  /**
   * Chiffre d'affaires mensuel qu'il faut encaisser pour que l'objectif net
   * tienne, charges fixes et sociales comprises. Exposé parce que c'est le
   * chiffre que le chauffeur reconnaît — un €/h dérivé ne se vérifie pas de
   * tête, un CA mensuel si.
   */
  requiredRevenue: number;
  /** Heures travaillées par mois (heures hebdo × semaines/mois). */
  monthlyHours: number;
  /**
   * Vrai quand l'objectif est atteignable sous le seuil de rentabilité — donc
   * que le plancher s'est appliqué. À annoncer comme une bonne nouvelle, pas
   * comme un réglage refusé.
   */
  flooredByProfitability: boolean;
};

/** Arrondi à 0,50 € près : un seuil affiché à 24,37 €/h ferait faussement précis. */
const roundHalf = (n: number) => Math.round(n * 2) / 2;

/**
 * Calcule le seuil à partir de l'objectif. Renvoie null si les entrées ne
 * permettent aucun calcul sensé (heures nulles ou négatives).
 *
 * Le plancher est le point clé : sans lui, un objectif modeste produirait un
 * seuil sous la rentabilité et l'app validerait des courses qui, une fois
 * l'usure et les charges comptées, coûtent de l'argent au chauffeur.
 */
export function deriveThreshold(input: GoalInput): DerivedThreshold | null {
  const { monthlyGoal, weeklyHours, fixedCosts, socialRate } = input;
  if (!Number.isFinite(weeklyHours) || weeklyHours <= 0) return null;
  if (!Number.isFinite(monthlyGoal) || monthlyGoal < 0) return null;

  const costs = Number.isFinite(fixedCosts) && fixedCosts > 0 ? fixedCosts : 0;
  // Borné sous 0,95 : au-delà le diviseur s'effondre et le seuil explose.
  const rate = Number.isFinite(socialRate) ? Math.min(Math.max(socialRate, 0), 0.95) : 0;
  const monthlyHours = weeklyHours * WEEKS_PER_MONTH;

  // Le chauffeur ne touche que (1 − taux) de ce qu'il encaisse : viser son net
  // sans ce terme sous-estimait le seuil d'environ 30 %, au point que le
  // plancher de rentabilité s'appliquait dans tous les cas réalistes.
  const requiredRevenue = (monthlyGoal + costs) / (1 - rate);
  const rawHourly = roundHalf(requiredRevenue / monthlyHours);

  const floored = rawHourly < FREE_THRESHOLDS.hourly;
  const hourly = floored ? FREE_THRESHOLDS.hourly : rawHourly;

  return {
    hourly,
    km: kmForHourly(hourly),
    rawHourly,
    requiredRevenue: Math.round(requiredRevenue),
    monthlyHours: Math.round(monthlyHours),
    flooredByProfitability: floored,
  };
}

/**
 * €/km correspondant à un €/h, par interpolation linéaire sur l'échelle des
 * paliers. Au-delà du dernier palier on prolonge la pente plutôt que de plafonner :
 * un chauffeur très exigeant doit voir son kilométrique suivre.
 */
export function kmForHourly(hourly: number): number {
  const first = KM_SCALE[0];
  const last = KM_SCALE[KM_SCALE.length - 1];
  if (hourly <= first.hourly) return first.km;

  for (let i = 0; i < KM_SCALE.length - 1; i++) {
    const a = KM_SCALE[i], b = KM_SCALE[i + 1];
    if (hourly <= b.hourly) {
      const ratio = (hourly - a.hourly) / (b.hourly - a.hourly);
      return round2(a.km + ratio * (b.km - a.km));
    }
  }
  // Prolongation au-delà du dernier palier, à la pente du dernier segment.
  const a = KM_SCALE[KM_SCALE.length - 2];
  const slope = (last.km - a.km) / (last.hourly - a.hourly);
  return round2(last.km + (hourly - last.hourly) * slope);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
