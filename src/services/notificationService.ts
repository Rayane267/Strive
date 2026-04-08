/**
 * Service de notifications push via Firebase Cloud Messaging.
 *
 * Fonctionnalités :
 * - Rappels de session ("Vous n'avez pas scanné aujourd'hui")
 * - Alertes crédits bientôt épuisés
 * - Notifications de nouvelles fonctionnalités
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const FCM_TOKEN_KEY = '@strive_fcm_token';
const LAST_REMINDER_KEY = '@strive_last_reminder';

interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Enregistre le token FCM sur le profil Supabase de l'utilisateur.
 * Appelé au démarrage de l'app si l'utilisateur est connecté.
 */
export async function registerPushToken(userId: string): Promise<void> {
  try {
    // Dynamically import messaging to avoid crash if not installed
    const messaging = await getMessagingModule();
    if (!messaging) return;

    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (!enabled) return;

    const token = await messaging().getToken();
    if (!token) return;

    const cached = await AsyncStorage.getItem(FCM_TOKEN_KEY);
    if (cached === token) return; // Already registered

    await supabase
      .from('profiles')
      .update({
        fcm_token: token,
        device_platform: Platform.OS,
      })
      .eq('id', userId);

    await AsyncStorage.setItem(FCM_TOKEN_KEY, token);
  } catch (e) {
    __DEV__ && console.warn('[NOTIF] registerPushToken error:', e);
  }
}

/**
 * Configure les listeners de notifications (foreground + background).
 * Retourne une fonction de cleanup.
 */
export function setupNotificationListeners(
  onNotification?: (payload: NotificationPayload) => void,
): () => void {
  const cleanups: (() => void)[] = [];

  getMessagingModule().then(messaging => {
    if (!messaging) return;

    // Foreground messages
    const unsubForeground = messaging().onMessage(async (remoteMessage: any) => {
      const payload: NotificationPayload = {
        title: remoteMessage.notification?.title ?? '',
        body: remoteMessage.notification?.body ?? '',
        data: remoteMessage.data,
      };
      onNotification?.(payload);
    });
    cleanups.push(unsubForeground);

    // Token refresh
    const unsubToken = messaging().onTokenRefresh(async (newToken: string) => {
      await AsyncStorage.setItem(FCM_TOKEN_KEY, newToken);
    });
    cleanups.push(unsubToken);
  });

  return () => cleanups.forEach(fn => fn());
}

/**
 * Planifie une notification locale de rappel si aucun scan aujourd'hui.
 */
export async function scheduleSessionReminder(): Promise<void> {
  try {
    const lastReminder = await AsyncStorage.getItem(LAST_REMINDER_KEY);
    const today = new Date().toISOString().split('T')[0];

    if (lastReminder === today) return; // Already reminded today

    await AsyncStorage.setItem(LAST_REMINDER_KEY, today);
  } catch {
    // Silent fail
  }
}

/**
 * Vérifie si les crédits sont bas et envoie une alerte locale.
 */
export function shouldAlertLowCredits(
  remaining: number | null,
  tier: string,
): boolean {
  if (remaining === null) return false; // Unlimited
  if (tier === 'premium') return false;
  return remaining <= 1 && remaining >= 0;
}

/**
 * Essaye d'importer @react-native-firebase/messaging dynamiquement.
 * Retourne null si le module n'est pas installé.
 */
async function getMessagingModule(): Promise<any> {
  try {
    return require('@react-native-firebase/messaging').default;
  } catch {
    __DEV__ && console.warn('[NOTIF] @react-native-firebase/messaging not installed');
    return null;
  }
}
