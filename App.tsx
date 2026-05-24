import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, DefaultTheme, LinkingOptions } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RNBootSplash from 'react-native-bootsplash';
import * as Sentry from '@sentry/react-native';
import RootNavigator from './src/navigation/RootNavigator';
import { colors } from './src/theme/colors';
import { SENTRY_DSN } from '@env';
import { version as appVersion } from './package.json';

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

Sentry.init({
  dsn: SENTRY_DSN || '',
  enabled: !__DEV__ && !!SENTRY_DSN,
  release: `com.striveapp.app@${appVersion}`,
  tracesSampleRate: 0.2,
  enableAutoSessionTracking: true,
  attachStacktrace: true,
});

// MainTabs est un BottomTabNavigator imbriqué → `screens` nested.
// `any` évite de dupliquer la déclaration du RootParamList pour le typage strict.
const linking: LinkingOptions<any> = {
  prefixes: ['strive://', 'https://strive.app'],
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
      <StatusBar
        barStyle="light-content"
        backgroundColor={colors.background}
      />
      <OfflineBanner />
      <NavigationContainer
        linking={linking}
        theme={AppTheme}
        onReady={() => {
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

export default App;
