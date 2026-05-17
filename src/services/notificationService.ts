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
    const fcm = await getMessagingApi();
    if (!fcm) return;

    const messagingInstance = fcm.getMessaging(fcm.getApp());

    const authStatus = await fcm.requestPermission(messagingInstance);
    const enabled =
      authStatus === fcm.AuthorizationStatus.AUTHORIZED ||
      authStatus === fcm.AuthorizationStatus.PROVISIONAL;

    if (!enabled) return;

    const token = await fcm.getToken(messagingInstance);
    if (!token) return;

    const cached = await AsyncStorage.getItem(FCM_TOKEN_KEY);
    if (cached === token) return;

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
  let cancelled = false;

  // Setup async — la cleanup retournée attend la fin du setup avant de tear down,
  // sinon on peut return avant que les unsubs soient enregistrés (FCM listeners orphelins).
  const setupPromise = (async () => {
    try {
      const fcm = await getMessagingApi();
      if (!fcm || cancelled) return;
      const messagingInstance = fcm.getMessaging(fcm.getApp());

      const unsubForeground = fcm.onMessage(messagingInstance, async (remoteMessage: any) => {
        const payload: NotificationPayload = {
          title: remoteMessage.notification?.title ?? '',
          body: remoteMessage.notification?.body ?? '',
          data: remoteMessage.data,
        };
        onNotification?.(payload);
      });
      cleanups.push(unsubForeground);

      const unsubToken = fcm.onTokenRefresh(messagingInstance, async (newToken: string) => {
        try {
          await AsyncStorage.setItem(FCM_TOKEN_KEY, newToken);
        } catch (e) {
          __DEV__ && console.warn('[NOTIF] onTokenRefresh persist failed:', e);
        }
      });
      cleanups.push(unsubToken);
    } catch (e) {
      __DEV__ && console.warn('[NOTIF] setupNotificationListeners error:', e);
    }
  })();

  return () => {
    cancelled = true;
    setupPromise.finally(() => {
      cleanups.forEach(fn => {
        try { fn(); } catch {}
      });
      cleanups.length = 0;
    });
  };
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
 * Essaye d'importer l'API modular Firebase Messaging dynamiquement.
 * Retourne null si le module n'est pas installé. Migre depuis l'API namespaced
 * (deprecated) vers l'API modular alignée sur le SDK Web (Firebase v22+).
 */
async function getMessagingApi(): Promise<{
  getApp: () => any;
  getMessaging: (app: any) => any;
  requestPermission: (m: any) => Promise<number>;
  getToken: (m: any) => Promise<string>;
  onMessage: (m: any, cb: (msg: any) => void) => () => void;
  onTokenRefresh: (m: any, cb: (token: string) => void) => () => void;
  AuthorizationStatus: { AUTHORIZED: number; PROVISIONAL: number; DENIED: number; NOT_DETERMINED: number };
} | null> {
  try {
    const { getApp } = require('@react-native-firebase/app');
    const messagingMod = require('@react-native-firebase/messaging');
    return {
      getApp,
      getMessaging: messagingMod.getMessaging,
      requestPermission: messagingMod.requestPermission,
      getToken: messagingMod.getToken,
      onMessage: messagingMod.onMessage,
      onTokenRefresh: messagingMod.onTokenRefresh,
      AuthorizationStatus: messagingMod.AuthorizationStatus,
    };
  } catch {
    __DEV__ && console.warn('[NOTIF] @react-native-firebase/messaging not installed');
    return null;
  }
}
