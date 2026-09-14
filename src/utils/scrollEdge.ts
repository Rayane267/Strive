/**
 * Bord bas adouci des ScrollView — l'effet `.soft` d'iOS 26.
 *
 * Le contenu se floute en approchant de la barre d'onglets au lieu d'être
 * tranché net contre elle.
 */

import { NativeModules, Platform } from 'react-native';

/**
 * iOS 26 sait dessiner l'effet lui-même (`UIScrollView.bottomEdgeEffect`).
 *
 * En dessous, personne ne le fait : c'est le dégradé masqué de la barre
 * d'onglets qui prend le relais. Les deux ne doivent jamais coexister, ils se
 * cumuleraient en un bas d'écran deux fois trop mou.
 *
 * `Platform.Version` vaut une chaîne du genre `"26.0"` sur iOS.
 */
export const HAS_NATIVE_SCROLL_EDGE =
  Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26;

/**
 * Demande au natif de (re)poser l'effet sur les ScrollView montées.
 *
 * À rejouer après chaque montage d'écran : une ScrollView qui vient d'arriver
 * n'a pas encore reçu l'effet. C'est idempotent, et ça ne coûte qu'un parcours
 * de la hiérarchie de vues.
 *
 * `?.` : un bundle JS peut tourner sur un binaire antérieur à l'ajout de la
 * méthode côté Swift, l'appel serait alors un TypeError.
 */
export function applySoftScrollEdges(): void {
  if (!HAS_NATIVE_SCROLL_EDGE) return;
  NativeModules.ScanBridge?.applySoftScrollEdges?.();
}
