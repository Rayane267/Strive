import { Platform } from 'react-native';
import { useBottomTabBarHeight as useJsTabBarHeight } from '@react-navigation/bottom-tabs';

/**
 * Hauteur à laisser libre sous le contenu d'un onglet.
 *
 * iOS : la barre d'onglets est NATIVE (react-native-bottom-tabs, le Liquid
 * Glass d'iOS 26) ; elle remonte sa vraie hauteur, et le hook de React
 * Navigation n'aurait aucun contexte à y lire — il lèverait une erreur.
 * Android : la barre JS de React Navigation, inchangée.
 *
 * Le choix se fait au chargement du module, jamais pendant un rendu : chaque
 * écran appelle toujours le même hook.
 */
export const useTabBarInset: () => number =
  Platform.OS === 'ios'
    ? require('react-native-bottom-tabs').useBottomTabBarHeight
    : useJsTabBarHeight;
