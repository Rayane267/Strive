import React from 'react';
import { StatusBar } from 'react-native';
import {
  NavigationContainer,
  DefaultTheme,
  LinkingOptions,
} from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RNBootSplash from 'react-native-bootsplash';
import * as Sentry from '@sentry/react-native';
import RootNavigator from './src/navigation/RootNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import { colors } from './src/theme/colors';
import { SENTRY_DSN } from '@env';
import { APP_VERSION, BUILD_NUMBER } from './src/utils/appVersion';

const AppTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
  },
};
import { AuthProvider } from './src/context/AuthContext';
import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineBanner from './src/components/OfflineBanner';
import { useOfflineSync } from './src/hooks/useOfflineSync';
import './src/i18n';

// Sans cette intégration, un crash remonte sa pile mais pas l'écran sur lequel
// il s'est produit : on sait QUE ça a cassé, pas OÙ. Elle ajoute le nom de la
// route courante à chaque événement, et le fil des navigations en breadcrumbs.
// Elle rend aussi utile le `tracesSampleRate` ci-dessous, qui collectait
// jusqu'ici des transactions sans contexte.
const navigationIntegration = Sentry.reactNavigationIntegration({
  // Les écrans imbriqués (MainTabs → Dashboard) apparaissent sous leur chemin
  // complet, sinon quatre onglets remontent tous comme « MainTabs ».
  useFullPathsForNavigationRoutes: true,
});

Sentry.init({
  dsn: SENTRY_DSN || '',
  enabled: !__DEV__ && !!SENTRY_DSN,
  // Version native du build (store) — package.json restait à 1.0.0, donc
  // toutes les releases Sentry étaient regroupées sous la même version.
  release: `com.striveapp.app@${APP_VERSION}`,
  dist: BUILD_NUMBER || undefined,
  tracesSampleRate: 0.2,
  enableAutoSessionTracking: true,
  attachStacktrace: true,
  integrations: [navigationIntegration],
});

// MainTabs est un BottomTabNavigator imbriqué → `screens` nested.
// `any` évite de dupliquer la déclaration du RootParamList pour le typage strict.
const linking: LinkingOptions<any> = {
  prefixes: ['strive://', 'https://striveapp.fr'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          Dashboard: 'dashboard',
          History: 'history',
          Analytics: 'analytics',
          Profile: 'profile',
        },
      },
      SubscriptionScreen: 'subscribe',
      CarSettings: 'car-settings',
      Preferences: 'preferences',
      ResetPassword: 'reset-password',
    },
  },
};

const AppContent = () => {
  useOfflineSync();

  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <OfflineBanner />
      <NavigationContainer
        ref={navigationRef}
        linking={linking}
        theme={AppTheme}
        onReady={() => {
          // Doit venir AVANT le masquage du splash : l'intégration doit tenir la
          // référence du conteneur dès la première route, sinon l'écran d'entrée
          // n'est pas rattaché aux événements qui s'y produisent.
          navigationIntegration.registerNavigationContainer(navigationRef);
          RNBootSplash.hide({ fade: true });
        }}
      >
        <RootNavigator />
      </NavigationContainer>
    </>
  );
};

const App = () => {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};

export default Sentry.wrap(App);
