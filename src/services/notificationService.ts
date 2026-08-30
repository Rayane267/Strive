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
import { navigateFromNotification } from '../navigation/navigationRef';
import { toLocalDateKey } from '../utils/dateUtils';

const FCM_TOKEN_KEY = '@strive_fcm_token';
const LAST_REMINDER_KEY = '@strive_last_reminder';

interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Verdict de l'enregistrement, pour que l'appelant puisse RÉAGIR.
 *
 * La fonction sortait en `void` quelle que soit l'issue. Conséquence sur iOS :
 * un chauffeur qui avait refusé les notifications une première fois voyait
 * l'interrupteur revenir en arrière sans un mot — le système ne repropose
 * JAMAIS sa fenêtre après un refus, il faut passer par les Réglages, et rien
 * ne le lui disait. `denied` existe pour qu'on puisse l'y emmener.
 */
export type PushRegisterResult = 'granted' | 'denied' | 'unavailable' | 'error';

/**
 * Enregistre le token FCM sur le profil Supabase de l'utilisateur.
 * Appelé au démarrage de l'app si l'utilisateur est connecté.
 */
export async function registerPushToken(
  userId: string,
  /**
   * `false` = on n'AFFICHE PAS la fenêtre système ; on enregistre le jeton
   * seulement si la permission est déjà accordée.
   *
   * C'est le mode du démarrage. Demander la permission au moment de la connexion
   * était le pire instant possible : le chauffeur vient de créer son compte, il
   * n'a encore rien vu de l'app, il n'a aucune raison de dire oui — et un refus
   * est définitif, le système ne repropose jamais sa fenêtre. Le seul bon moment
   * est celui où il coche l'interrupteur : là il l'a demandé.
   */
  prompt = true,
): Promise<PushRegisterResult> {
  try {
    const fcm = await getMessagingApi();
    if (!fcm) return 'unavailable';

    const messagingInstance = fcm.getMessaging(fcm.getApp());

    // C'est CET appel qui affiche la fenêtre « Strive souhaite vous envoyer des
    // notifications ». Il ne la montre qu'une fois par installation : ensuite le
    // système répond de mémoire, sans rien afficher.
    const authStatus = prompt
      ? await fcm.requestPermission(messagingInstance)
      : await fcm.hasPermission(messagingInstance);
    const enabled =
      authStatus === fcm.AuthorizationStatus.AUTHORIZED ||
      authStatus === fcm.AuthorizationStatus.PROVISIONAL;

    if (!enabled) return 'denied';

    const token = await fcm.getToken(messagingInstance);
    if (!token) return 'error';

    const cached = await AsyncStorage.getItem(FCM_TOKEN_KEY);
    if (cached === token) return 'granted';

    let appLang = 'fr';
    try {
      const i18n = require('../i18n').default;
      appLang = i18n.language ?? 'fr';
    } catch {}

    await supabase
      .from('profiles')
      .update({
        fcm_token: token,
        device_platform: Platform.OS,
        preferred_lang: appLang,
      })
      .eq('id', userId);

    await AsyncStorage.setItem(FCM_TOKEN_KEY, token);
    return 'granted';
  } catch (e) {
    __DEV__ && console.warn('[NOTIF] registerPushToken error:', e);
    return 'error';
  }
}

/**
 * Configure les listeners de notifications (foreground + background).
 * Retourne une fonction de cleanup.
 */
/**
 * État de la permission notifications, SANS jamais afficher la fenêtre système.
 *
 * Existe pour le récapitulatif du tutoriel : il doit pouvoir dire « Prêt » ou
 * « À activer » sans déclencher de demande — la fenêtre ne s'affiche qu'une fois
 * par installation, et la brûler en affichant un état serait la pire façon de la
 * perdre.
 *
 * `unknown` n'est pas un détail : sur un appareil sans Firebase configuré ou un
 * simulateur, on ne SAIT pas. Le récapitulatif doit alors le dire plutôt que
 * d'afficher un faux « Prêt » vert, qui ferait croire au chauffeur que son
 * installation fonctionne.
 */
export async function getNotificationStatus(): Promise<'granted' | 'denied' | 'unknown'> {
  try {
    const fcm = await getMessagingApi();
    if (!fcm) return 'unknown';
    const authStatus = await fcm.hasPermission(fcm.getMessaging(fcm.getApp()));
    return authStatus === fcm.AuthorizationStatus.AUTHORIZED ||
           authStatus === fcm.AuthorizationStatus.PROVISIONAL
      ? 'granted'
      : 'denied';
  } catch {
    return 'unknown';
  }
}

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

      // Tap sur une notif alors que l'app est en arrière-plan → deep-link.
      const unsubOpened = fcm.onNotificationOpenedApp(messagingInstance, (remoteMessage: any) => {
        navigateFromNotification(remoteMessage?.data);
      });
      cleanups.push(unsubOpened);

      // App lancée depuis l'état tué via une notif → deep-link initial.
      fcm.getInitialNotification(messagingInstance).then((remoteMessage: any) => {
        if (remoteMessage) navigateFromNotification(remoteMessage.data);
      });
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
    const today = toLocalDateKey(new Date());

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
  hasPermission: (m: any) => Promise<number>;
  getToken: (m: any) => Promise<string>;
  onMessage: (m: any, cb: (msg: any) => void) => () => void;
  onTokenRefresh: (m: any, cb: (token: string) => void) => () => void;
  onNotificationOpenedApp: (m: any, cb: (msg: any) => void) => () => void;
  getInitialNotification: (m: any) => Promise<any>;
  AuthorizationStatus: { AUTHORIZED: number; PROVISIONAL: number; DENIED: number; NOT_DETERMINED: number };
} | null> {
  try {
    const { getApp } = require('@react-native-firebase/app');
    const messagingMod = require('@react-native-firebase/messaging');
    return {
      getApp,
      getMessaging: messagingMod.getMessaging,
      requestPermission: messagingMod.requestPermission,
      hasPermission: messagingMod.hasPermission,
      getToken: messagingMod.getToken,
      onMessage: messagingMod.onMessage,
      onTokenRefresh: messagingMod.onTokenRefresh,
      onNotificationOpenedApp: messagingMod.onNotificationOpenedApp,
      getInitialNotification: messagingMod.getInitialNotification,
      AuthorizationStatus: messagingMod.AuthorizationStatus,
    };
  } catch {
    __DEV__ && console.warn('[NOTIF] @react-native-firebase/messaging not installed');
    return null;
  }
}

/**
 * Coupe les notifications push pour ce compte.
 *
 * Le jeton est effacé côté serveur ET dans le cache local. Effacer seulement le
 * cache laisserait le serveur continuer d'émettre vers un appareil qui n'en veut
 * plus ; n'effacer que la base ferait croire au prochain démarrage que le jeton
 * est déjà enregistré — `registerPushToken` sort tôt quand le cache correspond.
 *
 * La permission système n'est pas révoquée : seul le réglage iOS/Android le peut.
 * On cesse simplement d'être joignable.
 */
export async function unregisterPushToken(userId: string): Promise<void> {
  try {
    await supabase
      .from('profiles')
      .update({ fcm_token: null })
      .eq('id', userId);
    await AsyncStorage.removeItem(FCM_TOKEN_KEY);
  } catch (e) {
    __DEV__ && console.warn('[NOTIF] unregisterPushToken error:', e);
  }
}
