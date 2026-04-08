/**
 * Utilitaire de feedback haptique cross-platform.
 * Utilise l'API Vibration de React Native (pas de dépendance externe).
 */

import { Platform, Vibration } from 'react-native';

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
