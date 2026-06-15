import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';

const NOTIF_CHANNEL_ID = 'strive_reminders';
const QUOTA_RESET_KEY = '@strive_quota_reset_scheduled';

let PushNotification: any = null;
try {
  PushNotification = Platform.OS === 'android'
    ? require('react-native-push-notification')
    : null;
} catch {}

function scheduleNative(id: string, title: string, body: string, delayMs: number) {
  const fireDate = new Date(Date.now() + delayMs);

  if (Platform.OS === 'ios') {
    // iOS: use UNUserNotificationCenter via native module bridge
    // Since we don't have a dedicated local notif lib, we use the
    // UserNotifications API through the existing RN bridge
    try {
      const { NativeModules } = require('react-native');
      const { ScanBridge } = NativeModules;
      if (ScanBridge?.scheduleLocalNotification) {
        ScanBridge.scheduleLocalNotification(id, title, body, delayMs / 1000);
        return;
      }
    } catch {}
    // Fallback: use setTimeout (only works while app is in foreground/background)
    setTimeout(() => {
      // Can't show notification from JS when app is suspended
    }, delayMs);
  } else if (PushNotification) {
    PushNotification.localNotificationSchedule({
      id,
      channelId: NOTIF_CHANNEL_ID,
      title,
      message: body,
      date: fireDate,
      allowWhileIdle: true,
    });
  }
}

function cancelNative(id: string) {
  if (Platform.OS === 'ios') {
    try {
      const { NativeModules } = require('react-native');
      const { ScanBridge } = NativeModules;
      ScanBridge?.cancelLocalNotification?.(id);
    } catch {}
  } else if (PushNotification) {
    PushNotification.cancelLocalNotification(id);
  }
}

/**
 * Programme une notification "Pas de scan depuis 1h — fermez votre session"
 * Appelee quand le chauffeur passe en ligne. Annulee a chaque scan.
 */
export function scheduleInactivityReminder() {
  cancelNative('inactivity');
  scheduleNative(
    'inactivity',
    i18n.t('notifications.inactivity.title'),
    i18n.t('notifications.inactivity.body'),
    3600_000,
  );
}

export function cancelInactivityReminder() {
  cancelNative('inactivity');
}

export function resetInactivityReminder() {
  cancelNative('inactivity');
  scheduleNative(
    'inactivity',
    i18n.t('notifications.inactivity.title'),
    i18n.t('notifications.inactivity.body'),
    3600_000,
  );
}

/**
 * Programme une notification au reset du quota journalier.
 * @param resetHour 0 = minuit, 4 = 4h du matin
 */
export async function scheduleQuotaResetNotification(resetHour: number) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const key = `${QUOTA_RESET_KEY}_${today}`;
    const already = await AsyncStorage.getItem(key);
    if (already) return;

    const now = new Date();
    const reset = new Date();
    reset.setHours(resetHour, 0, 0, 0);
    if (reset <= now) reset.setDate(reset.getDate() + 1);

    const delayMs = reset.getTime() - now.getTime();
    if (delayMs > 0 && delayMs < 24 * 3600_000) {
      scheduleNative(
        'quota-reset',
        i18n.t('notifications.quotaReset.title'),
        i18n.t('notifications.quotaReset.body'),
        delayMs,
      );
      await AsyncStorage.setItem(key, 'true');
    }
  } catch {}
}

export function notifyQuotaReached(resetHour: number) {
  const now = new Date();
  const reset = new Date();
  reset.setHours(resetHour, 0, 0, 0);
  if (reset <= now) reset.setDate(reset.getDate() + 1);

  const diffMs = reset.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3600_000);
  const mins = Math.floor((diffMs % 3600_000) / 60_000);
  const timeStr = hours > 0 ? `${hours}h${mins > 0 ? mins.toString().padStart(2, '0') : ''}` : `${mins}min`;

  scheduleNative(
    'quota-reached',
    i18n.t('notifications.quotaReached.title'),
    i18n.t('notifications.quotaReached.body', { time: timeStr }),
    0,
  );
}

/**
 * Programme une notification "Session fermee automatiquement"
 * quand l'auto-close se declenche.
 */
/**
 * Récap hebdo (dimanche ~19h) — ré-engagement free → ouvre l'app → voit le
 * tease de perte. Reprogrammé à chaque ouverture (one-shot) ; le montant est le
 * cumul "cette semaine jusqu'ici" → ne peut que sous-estimer, jamais sur-promettre.
 * `lossEur` optionnel : si absent/faible, message générique.
 */
export function scheduleWeeklyRecap(lossEur?: number) {
  cancelNative('weekly-recap');
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + ((7 - now.getDay()) % 7)); // prochain dimanche (0=dim)
  next.setHours(19, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);

  const delayMs = next.getTime() - now.getTime();
  const body = lossEur && lossEur >= 10
    ? i18n.t('notifications.weeklyRecap.bodyLoss', { eur: Math.round(lossEur) })
    : i18n.t('notifications.weeklyRecap.body');
  scheduleNative('weekly-recap', i18n.t('notifications.weeklyRecap.title'), body, delayMs);
}

export function cancelWeeklyRecap() {
  cancelNative('weekly-recap');
}

export function notifySessionClosed() {
  scheduleNative(
    'session-closed',
    i18n.t('notifications.sessionClosed.title'),
    i18n.t('notifications.sessionClosed.body'),
    0,
  );
}

/**
 * Prévient l'utilisateur que des courses hors-ligne n'ont pas pu être
 * synchronisées (abandonnées après MAX_RETRY_COUNT tentatives). Sans ça,
 * des revenus disparaissent silencieusement de ses stats.
 */
export function notifySyncDropped(count: number) {
  scheduleNative(
    'sync-dropped',
    i18n.t('notifications.syncDropped.title'),
    i18n.t('notifications.syncDropped.body', { count }),
    0,
  );
}
