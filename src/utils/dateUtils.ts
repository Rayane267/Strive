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