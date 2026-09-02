// src/utils/dateUtils.ts

/**
 * Retourne le début de la "journée" en tenant compte du day_reset_hour.
 * Ex : si resetHour=3 et il est 2h du matin → on est encore dans la journée d'hier → retourne hier 3h.
 *      si resetHour=3 et il est 10h du matin → retourne aujourd'hui 3h.
 *      si resetHour=0 → retourne aujourd'hui 00:00 (comportement classique).
 */
export function getDayStart(resetHour: number = 0): Date {
  const now = new Date();
  const start = new Date(now);
  start.setHours(resetHour, 0, 0, 0);
  if (start.getTime() > now.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  return start;
}

/**
 * Clé de jour `YYYY-MM-DD` dans le fuseau LOCAL.
 * `toISOString().split('T')[0]` donne le jour UTC : à Paris (UTC+2) il bascule
 * dès 22h locale, ce qui décale d'un jour les repères du calendrier.
 */
/**
 * Debut de la semaine EN COURS, lundi comme premier jour.
 *
 * `(day + 6) % 7` traduit la numerotation JS (dimanche = 0) en un decalage
 * depuis lundi : un dimanche rend 6, donc la semaine remonte au lundi
 * precedent et non au lendemain.
 *
 * Passe par `getDayStart` pour heriter du `resetHour` : avec un reset a 4 h,
 * une course prise lundi a 2 h appartient encore a la journee de dimanche,
 * donc a la semaine passee. C'est toute la difference entre « les 7 derniers
 * jours », qui glisse, et « cette semaine », qui repart le lundi.
 */
export function getWeekStart(resetHour: number = 0): Date {
  const start = getDayStart(resetHour);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export function toLocalDateKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * Clé de la "journée de travail" à laquelle appartient un instant, selon le
 * day_reset_hour. Avec resetHour=4, une course de 1h du matin appartient à la
 * journée de la veille — même découpage que getDayStart() et user_day_start côté DB.
 */
export function getBusinessDayKey(date: Date | string, resetHour: number = 0): string {
  const d = new Date(date);
  d.setHours(d.getHours() - resetHour);
  return toLocalDateKey(d);
}

/**
 * Parse une clé `YYYY-MM-DD` en Date LOCALE (minuit local).
 * `new Date('2026-08-11')` serait interprété en UTC → jour précédent à l'ouest.
 */
export function parseLocalDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * Calcule le temps écoulé depuis un scan et retourne une chaîne traduite
 */
export const formatTimeAgo = (dateString: string, t: any): string => {
  const now = new Date();
  const scanDate = new Date(dateString);

  // Différence en millisecondes convertie en minutes
  const diffInMins = Math.floor((now.getTime() - scanDate.getTime()) / 60000);

  if (diffInMins < 1) {
    return t('dashboard.timeLabels.justNow');
  }

  if (diffInMins < 60) {
    return t('dashboard.timeLabels.minutesAgo', { count: diffInMins });
  }

  const diffInHours = Math.floor(diffInMins / 60);
  if (diffInHours < 24) {
    return t('dashboard.timeLabels.hoursAgo', { count: diffInHours });
  }

  // Au-delà de 24 h, « Il y a 37 h » ne se lit plus : on bascule en jours.
  const diffInDays = Math.floor(diffInHours / 24);
  return t('dashboard.timeLabels.daysAgo', { count: diffInDays });
};

/**
 * Convertit des secondes en format lisible (ex: 1h 25m 04s)
 */
export const formatDuration = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h${minutes > 0 ? ` ${String(minutes).padStart(2, '0')}min` : ''}`;
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
};