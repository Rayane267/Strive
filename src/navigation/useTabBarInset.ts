import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tabBarClearance } from './tabBarMetrics';

/**
 * Hauteur à laisser libre sous le contenu d'un onglet.
 *
 * iOS : la barre d'onglets est NATIVE (react-native-bottom-tabs, le Liquid
 * Glass d'iOS 26) ; elle remonte sa vraie hauteur, et le hook de React
 * Navigation n'aurait aucun contexte à y lire — il lèverait une erreur.
 * Android : la capsule flottante est dessinée à la main (TabNavigator). React
 * Navigation n'en connaît pas la hauteur et renverrait celle d'une barre
 * standard, plus basse : la fin des listes passerait sous la capsule.
 *
 * Le choix se fait au chargement du module, jamais pendant un rendu : chaque
 * écran appelle toujours le même hook.
 */
const useCapsuleClearance = () => tabBarClearance(useSafeAreaInsets().bottom);

export const useTabBarInset: () => number =
  Platform.OS === 'ios'
    ? require('react-native-bottom-tabs').useBottomTabBarHeight
    : useCapsuleClearance;
