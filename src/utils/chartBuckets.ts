/**
 * Regroupement des séries de l'écran Stats selon la durée affichée.
 *
 * Les graphes étaient construits jour par jour quelle que soit la période. Tant
 * que l'historique était borné à sept jours, ça allait : sept barres, sept
 * libellés distincts. Depuis que Premium peut demander un mois ou une année, la
 * même boucle produit trente à trois cent soixante-cinq barres étiquetées avec
 * les mêmes sept abréviations répétées — illisible, et sans information.
 *
 * On choisit donc la maille d'après la durée, pour rester dans une fourchette
 * lisible sur un téléphone : jamais moins de deux points, rarement plus d'une
 * quinzaine.
 */

export type Granularity = 'day' | 'week' | 'month';

/** Un jour de travail, gaps compris (un jour sans course vaut zéro). */
export interface DayPoint {
  /** Clé de journée de travail `YYYY-MM-DD`, déjà décalée du `day_reset_hour`. */
  key: string;
  date: Date;
  earnings: number;
  distance: number;
  hours: number;
  isToday?: boolean;
}

export interface SeriesPoint {
  label: string;
  earnings: number;
  distance: number;
  hours: number;
  /** Vrai si le seau contient la journée en cours. */
  isToday?: boolean;
}

/**
 * La maille pour une durée donnée.
 *
 * Les seuils sont choisis sur le NOMBRE DE BARRES obtenu, pas sur des durées
 * rondes : deux semaines font quatorze barres, ce qui passe encore ; un
 * trimestre en fait treize à la semaine ; une année en fait douze au mois.
 * Au-delà de quatre-vingt-douze jours la maille hebdomadaire dépasserait la
 * quinzaine de barres, d'où la bascule au mois.
 */
export function pickGranularity(dayCount: number): Granularity {
  if (dayCount <= 14) return 'day';
  if (dayCount <= 92) return 'week';
  return 'month';
}

/** Lundi de la semaine d'une date. `(getDay() + 6) % 7` : dimanche rend 6. */
function weekStartOf(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function bucketKey(date: Date, granularity: Granularity): string {
  if (granularity === 'day') return date.toDateString();
  if (granularity === 'week') return weekStartOf(date).toDateString();
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function bucketLabel(
  date: Date,
  granularity: Granularity,
  opts: { locale: string; dayLabels: string[]; short: boolean },
): string {
  if (granularity === 'day') {
    // Sur une semaine, l'abréviation du jour suffit et tient en deux
    // caractères. Au-delà, deux « Lu » dans le même graphe ne désignent pas le
    // même jour : on passe au quantième.
    return opts.short
      ? opts.dayLabels[date.getDay()]
      : `${date.getDate()}/${date.getMonth() + 1}`;
  }
  if (granularity === 'week') {
    const start = weekStartOf(date);
    return `${start.getDate()}/${start.getMonth() + 1}`;
  }
  const name = date.toLocaleDateString(opts.locale, { month: 'short' });
  return name.charAt(0).toUpperCase() + name.slice(1).replace('.', '');
}

/**
 * Replie une série journalière dans la maille demandée.
 *
 * Les euros, les kilomètres et les heures se SOMMENT ; les taux se recalculent
 * ensuite à partir des sommes. C'est la seule façon juste : moyenner les €/h
 * journaliers d'une semaine donnerait le même poids à une vacation de dix
 * heures et à une course isolée.
 */
export function foldSeries(
  days: DayPoint[],
  granularity: Granularity,
  opts: { locale: string; dayLabels: string[] },
): SeriesPoint[] {
  const short = granularity === 'day' && days.length <= 7;
  const buckets = new Map<string, SeriesPoint>();

  for (const day of days) {
    const key = bucketKey(day.date, granularity);
    const bucket = buckets.get(key) ?? {
      label: bucketLabel(day.date, granularity, { ...opts, short }),
      earnings: 0,
      distance: 0,
      hours: 0,
    };
    bucket.earnings += day.earnings;
    bucket.distance += day.distance;
    bucket.hours += day.hours;
    if (day.isToday) bucket.isToday = true;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values());
}

/**
 * Taux d'une série repliée : euros par heure, ou euros par kilomètre.
 *
 * Les seaux VIDES sont écartés plutôt que rendus à zéro. Un zéro dans une
 * courbe de taux se lit « ce jour-là vous avez travaillé pour rien », alors
 * qu'il veut dire « ce jour-là vous n'avez pas travaillé » — deux choses
 * opposées, et la seconde n'a pas sa place dans une tendance de rentabilité.
 */
export function toRateSeries(
  series: SeriesPoint[],
  by: 'hours' | 'distance',
): { label: string; value: number }[] {
  return series
    .filter(p => p[by] > 0 && p.earnings > 0)
    .map(p => ({ label: p.label, value: p.earnings / p[by] }));
}
