import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RNBootSplash from 'react-native-bootsplash';
import * as Sentry from '@sentry/react-native';
import RootNavigator from './src/navigation/RootNavigator';
import { colors } from './src/theme/colors';
import { AuthProvider } from './src/context/AuthContext';
import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineBanner from './src/components/OfflineBanner';
import { useOfflineSync } from './src/hooks/useOfflineSync';
import './src/i18n';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? '',
  enabled: !__DEV__ && !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
});

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
