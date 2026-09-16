/**
 * Dérivation du seuil de rentabilité à partir de l'objectif du chauffeur.
 *
 * Demander « ton minimum €/h ? » sur un curseur de 10 à 80 € est une question à
 * laquelle personne ne sait répondre. « Combien tu veux gagner » et « combien
 * d'heures tu roules » sont immédiats — et suffisent à calculer le premier.
 */

import { MARKETS, DEFAULT_COUNTRY, type Market } from './market';

/** Semaines moyennes par mois (52 / 12). */
export const WEEKS_PER_MONTH = 4.33;



/**
 * Les taux de cotisations ont déménagé dans `utils/market.ts` : ils dépendent du
 * pays, et un module qui calcule un seuil n'a pas à savoir lequel. Ce fichier ne
 * reçoit plus qu'un NOMBRE et la BASE sur laquelle il porte — le reste est une
 * question de régime, pas d'arithmétique.
 */

export type GoalInput = {
  /** Revenu NET mensuel visé, dans la devise du marché. */
  monthlyGoal: number;
  /** Heures travaillées par semaine. */
  weeklyHours: number;
  /** Charges fixes mensuelles (LOA, assurance…), dans la devise du marché. */
  fixedCosts: number;
  /** Part prélevée en cotisations sociales (0,212 = 21,2 %). */
  socialRate: number;
  /**
   * Ce sur quoi `socialRate` porte. Ne sert qu'à UNE chose : savoir si les
   * charges fixes se déduisent avant ou après les cotisations. Voir
   * `deriveThreshold`.
   *
   * Absent → `revenue`, le traitement du micro-entrepreneur français, qui était
   * le comportement d'origine. C'est aussi le sens prudent : il remonte les
   * charges au brut, donc il ne sous-estime jamais le seuil.
   */
  base?: 'revenue' | 'profit';
};

export type DerivedThreshold = {
  /** Seuil horaire retenu, plancher de rentabilité appliqué. */
  hourly: number;
  /**
   * Seuil par unité de distance, DANS L'UNITÉ DU MARCHÉ : par kilomètre
   * partout, par mile au Royaume-Uni. Le nom de la colonne qui le stocke
   * (`profiles.min_km_rate`) dit « km » pour des raisons d'historique ;
   * `profiles.country` est ce qui en donne l'unité.
   */
  distance: number;
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
export function deriveThreshold(
  input: GoalInput,
  /** Marché du chauffeur — il porte le plancher, l'échelle et l'unité. */
  market: Market = MARKETS[DEFAULT_COUNTRY],
): DerivedThreshold | null {
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
  //
  // MAIS les charges fixes ne se placent pas au même endroit selon le statut.
  //
  //   • Auto-entrepreneur — les cotisations portent sur le CA ENCAISSÉ, LOA
  //     comprise. La LOA doit donc être remontée au brut elle aussi :
  //         CA = (net + fixes) ÷ (1 − taux)
  //
  //   • Société — la LOA, l'assurance et le reste sont des charges
  //     d'exploitation, déduites AVANT la rémunération. Les cotisations ne
  //     portent que sur ce qui est versé au dirigeant :
  //         CA = net ÷ (1 − taux) + fixes
  //
  // Les diviser pour tout le monde surestimait le CA nécessaire en société.
  // Sur 3 500 € net, 1 400 € de charges et 45 % : 8 909 € annoncés contre
  // 7 764 € réels, soit 68,5 €/h au lieu de 59,5 €/h sur 130 heures. Le
  // chauffeur refusait des courses qui lui convenaient.
  //
  // C'est exactement ce que porte `base` : « profit » veut dire que les charges
  // sont déjà déduites quand les cotisations s'appliquent. La Belgique (20,5 %
  // du revenu NET), la Suisse (10,6 % du revenu net) et le sole trader
  // britannique (NI sur le bénéfice) sont dans ce cas ; le micro-entrepreneur
  // français et le trabalhador independente portugais, non.
  const chargesBeforeContributions = input.base === 'profit';
  const requiredRevenue = chargesBeforeContributions
    ? monthlyGoal / (1 - rate) + costs
    : (monthlyGoal + costs) / (1 - rate);
  const rawHourly = roundHalf(requiredRevenue / monthlyHours);

  const floored = rawHourly < market.thresholds.hourly;
  const hourly = floored ? market.thresholds.hourly : rawHourly;

  return {
    hourly,
    distance: distanceForHourly(hourly, market),
    rawHourly,
    requiredRevenue: Math.round(requiredRevenue),
    monthlyHours: Math.round(monthlyHours),
    flooredByProfitability: floored,
  };
}

/**
 * Seuil par unité de distance correspondant à un seuil horaire, par
 * interpolation linéaire sur l'échelle du marché. Au-delà du dernier palier on
 * prolonge la pente plutôt que de plafonner : un chauffeur très exigeant doit
 * voir son kilométrique suivre.
 *
 * L'échelle NE SE DÉRIVE PAS de l'objectif : il faudrait connaître la vitesse
 * moyenne du chauffeur, inconnue à l'onboarding. Elle est donc calée sur les
 * paliers du tutoriel — et c'est le marché qui dit lesquels, puisqu'un palier
 * britannique s'exprime en livres.
 *
 * PAR KILOMÈTRE, y compris au Royaume-Uni : `thresholds.scale` est métrique sur
 * les six marchés, et la valeur qui sort d'ici part telle quelle dans
 * `preferences.min_km_rate`, que le verdict natif compare à un `km_rate`
 * métrique. Le mile n'existe qu'à l'affichage, via `toMarketRate`.
 */
export function distanceForHourly(hourly: number, market: Market): number {
  const scale = market.thresholds.scale;
  const first = scale[0];
  const last = scale[scale.length - 1];
  if (hourly <= first.hourly) return first.distance;

  for (let i = 0; i < scale.length - 1; i++) {
    const a = scale[i], b = scale[i + 1];
    if (hourly <= b.hourly) {
      const ratio = (hourly - a.hourly) / (b.hourly - a.hourly);
      return round2(a.distance + ratio * (b.distance - a.distance));
    }
  }
  // Prolongation au-delà du dernier palier, à la pente du dernier segment.
  const a = scale[scale.length - 2];
  const slope = (last.distance - a.distance) / (last.hourly - a.hourly);
  return round2(last.distance + (hourly - last.hourly) * slope);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
