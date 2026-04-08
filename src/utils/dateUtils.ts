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
  return t('dashboard.timeLabels.hoursAgo', { count: diffInHours });


};

/**
 * Convertit des secondes en format lisible (ex: 1h 25m 04s)
 */
export const formatDuration = (totalSeconds: number): string => {
  if (totalSeconds <= 0) return '0s';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // Format avec Heures (ex: 1h 05m 10s)
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  // Format avec Minutes (ex: 2m 45s)
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  // Format Secondes uniquement (ex: 30s)
  return `${seconds}s`;
};