import { Linking, NativeModules, Platform } from 'react-native';

const { ScanBridge } = NativeModules;

/**
 * OUVRIR LE BON RÉGLAGE, PAS « LES RÉGLAGES ».
 *
 * Tous les écrans appelaient `Linking.openSettings()`, qui dépose le chauffeur
 * sur la fiche générale de l'app. Depuis là, activer les notifications, trouver
 * AssistiveTouch ou autoriser les notifications urgentes sont trois chemins
 * différents — et aucun n'est indiqué. Un bouton qui promet « ouvrir les
 * réglages » et laisse chercher est à peine mieux qu'un bouton mort.
 *
 * Ce module concentre ce qu'on sait vraiment atteindre, par plateforme. Il ne
 * promet jamais plus que ce que l'OS permet : quand la cible exacte est hors de
 * portée, il retombe sur la fiche de l'app plutôt que d'échouer en silence.
 */

/** Le paquet Android, en dur : `APP_NOTIFICATION_SETTINGS` exige de nommer
 *  l'application et rien côté JS ne l'expose. Aligné sur `applicationId`
 *  (android/app/build.gradle). */
const ANDROID_PACKAGE = 'com.strive';

export type SettingsTarget =
  /** Notifications de l'app : canaux sur Android, autorisations sur iOS. */
  | 'notifications'
  /** Accessibilité : AssistiveTouch sur iOS, service Strive sur Android. */
  | 'accessibility'
  /** Fiche réglages de l'app, quand il n'y a pas de cible plus précise. */
  | 'app';

/**
 * CE QUE CHAQUE PLATEFORME PERMET RÉELLEMENT.
 *
 * Android — deux intents publics et documentés mènent pile au bon écran :
 * `APP_NOTIFICATION_SETTINGS` (avec le paquet en extra) et
 * `ACCESSIBILITY_SETTINGS`. `sendIntent` rejette s'il n'y a aucune activité
 * pour les recevoir (ROM exotique, constructeur qui a retiré l'écran) : on
 * retombe alors sur la fiche de l'app, jamais sur rien.
 *
 * iOS — `App-prefs:` mènerait n'importe où dans les Réglages, mais c'est un
 * schéma d'URL PRIVÉ : sans effet sur les iOS récents et motif de rejet en
 * revue (règle 2.5.1). La seule exception publique est
 * `UIApplication.openNotificationSettingsURLString` (iOS 15.4+), exposée ici
 * par le pont natif `ScanBridge.openNotificationSettings`. Tout le reste —
 * l'accessibilité en particulier — n'a aucune API : on ouvre la fiche de l'app
 * et ce sont les étapes numérotées de l'écran qui donnent le chemin.
 */
export function openSettingsFor(target: SettingsTarget): void {
  if (Platform.OS === 'android') {
    if (target === 'notifications') {
      Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
        { key: 'android.provider.extra.APP_PACKAGE', value: ANDROID_PACKAGE },
      ]).catch(() => Linking.openSettings());
      return;
    }
    if (target === 'accessibility') {
      Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS').catch(() =>
        Linking.openSettings(),
      );
      return;
    }
    Linking.openSettings();
    return;
  }

  // `typeof` et non `?.` seul : sur un build antérieur à l'ajout de la méthode
  // native, l'appeler lèverait. Le repli garde l'ancien comportement plutôt que
  // de casser un bouton qui marchait.
  if (target === 'notifications' && typeof ScanBridge?.openNotificationSettings === 'function') {
    ScanBridge.openNotificationSettings();
    return;
  }
  Linking.openSettings();
}

/** L'app Raccourcis d'Apple. Ce n'est pas un réglage — c'est là que le chauffeur
 *  vérifie que « Analyser une course » existe bien. Repli sur la fiche de l'app
 *  si Raccourcis a été désinstallée. */
export function openShortcutsApp(): void {
  Linking.openURL('shortcuts://').catch(() => Linking.openSettings());
}
