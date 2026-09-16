/**
 * Utilitaire de feedback haptique cross-platform.
 * Utilise l'API Vibration de React Native (pas de dépendance externe).
 */

import { NativeModules, Platform, Vibration } from 'react-native';

/**
 * Sélection — changement d'onglet, curseur qui passe un cran.
 *
 * Sur iOS on passe par le Taptic Engine (`UISelectionFeedbackGenerator`) : c'est
 * le tic sec des sélecteurs système. `Vibration.vibrate()` y déclenche le
 * vibreur entier quelle que soit la durée demandée — une secousse là où l'on
 * attend un tic. `?.` : un bundle JS peut tourner sur un binaire antérieur à
 * l'ajout de la méthode, l'appel serait alors un TypeError.
 *
 * Android n'a pas d'équivalent système : une impulsion très courte s'en approche.
 */
export function hapticSelection(): void {
  if (Platform.OS === 'ios') {
    NativeModules.ScanBridge?.selectionHaptic?.();
    return;
  }
  Vibration.vibrate(8);
}

/** Feedback léger — tap, navigation */
export function hapticLight(): void {
  if (Platform.OS === 'android') {
    Vibration.vibrate(10);
  }
  // iOS : Vibration.vibrate() produit un feedback similaire
  if (Platform.OS === 'ios') {
    Vibration.vibrate(1);
  }
}

/** Feedback moyen — action confirmée (accept, toggle) */
export function hapticMedium(): void {
  Vibration.vibrate(25);
}

/** Feedback fort — action importante (scan result, error) */
export function hapticHeavy(): void {
  Vibration.vibrate(50);
}

/** Double vibration — succès (course acceptée) */
export function hapticSuccess(): void {
  Vibration.vibrate([0, 30, 80, 30]);
}

/** Pattern d'erreur — échec (scan failed) */
export function hapticError(): void {
  Vibration.vibrate([0, 50, 100, 50]);
}
