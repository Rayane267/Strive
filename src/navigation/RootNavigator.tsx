import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import SplashScreen from '../components/SplashScreen';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { withErrorBoundary } from '../components/ErrorBoundary';

// Imports des écrans — chaque screen est isolé dans son ErrorBoundary pour
// éviter qu'un crash local blanchisse toute l'app.
import TabNavigator from './TabNavigator';
import AuthScreenRaw from '../screens/AuthScreen';
import CarSettingsScreenRaw from '../screens/CarSettingsScreen';
import AccountInfoScreenRaw from '../screens/AccountInfoScreen';
import PreferencesScreenRaw from '../screens/PreferencesScreen.tsx';
import ProfileSetupScreenRaw from '../screens/ProfileSetupScreen.tsx';
import SubscriptionScreenRaw from '../screens/SubscriptionScreen.tsx';
import ScannerPermissionScreenRaw from '../screens/ScannerPermissionScreen';
import TutorialScreenRaw from '../screens/TutorialScreen';
import HelpScreenRaw from '../screens/HelpScreen';
import ResetPasswordScreenRaw from '../screens/ResetPasswordScreen';

const AuthScreen = withErrorBoundary(AuthScreenRaw);
const CarSettingsScreen = withErrorBoundary(CarSettingsScreenRaw);
const AccountInfoScreen = withErrorBoundary(AccountInfoScreenRaw);
const PreferencesScreen = withErrorBoundary(PreferencesScreenRaw);
const ProfileSetupScreen = withErrorBoundary(ProfileSetupScreenRaw);
const SubscriptionScreen = withErrorBoundary(SubscriptionScreenRaw);
const ScannerPermissionScreen = withErrorBoundary(ScannerPermissionScreenRaw);
const TutorialScreen = withErrorBoundary(TutorialScreenRaw);
const HelpScreen = withErrorBoundary(HelpScreenRaw);
const ResetPasswordScreen = withErrorBoundary(ResetPasswordScreenRaw);

const Stack = createNativeStackNavigator();

const RootNavigator = () => {
  const { user, profile, loading, profileError, refreshProfile } = useAuth();
  const { t } = useTranslation();

  if (loading || (user && profile === null && !profileError)) {
    return <SplashScreen />;
  }

  if (user && profileError) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#0A120E',
          gap: 16,
        }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 16 }}>
          {t('errors.profileLoadFailed', 'Impossible de charger votre profil.')}
        </Text>
        <TouchableOpacity
          onPress={refreshProfile}
          style={{
            backgroundColor: '#00E676',
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: '#000', fontWeight: 'bold' }}>
            {t('common.retry', 'Réessayer')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Stack.Navigator>
      {!user ? (
        <>
          <Stack.Screen
            name="Auth"
            component={AuthScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ResetPassword"
            component={ResetPasswordScreen}
            options={{ headerShown: false }}
          />
        </>
      ) : !profile || !profile.first_name ? (
        <Stack.Screen
          name="ProfileSetup"
          component={ProfileSetupScreen}
          options={{ headerShown: false }}
        />
      ) : (
        <>
          <Stack.Screen
            name="MainTabs"
            component={TabNavigator}
            options={{ headerShown: false }}
          />

          {/* ✅ On désactive les headers natifs pour laisser nos pages gérer leur propre design */}
          <Stack.Screen
            name="CarSettings"
            component={CarSettingsScreen}
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />

          <Stack.Screen
            name="Preferences"
            component={PreferencesScreen}
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />

          <Stack.Screen
            name="AccountInfo"
            component={AccountInfoScreen}
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />

          <Stack.Screen
            name="Tutorial"
            component={TutorialScreen}
            options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }}
          />

          <Stack.Screen
            name="Help"
            component={HelpScreen}
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />

          {/* Modales */}
          <Stack.Screen
            name="SubscriptionScreen"
            component={SubscriptionScreen}
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
            }}
          />

          <Stack.Screen
            name="ScannerPermission"
            component={ScannerPermissionScreen}
            options={{
              headerShown: false,
              presentation: 'modal',
              animation: 'slide_from_bottom',
            }}
          />

        </>
      )}
    </Stack.Navigator>
  );
};

export default RootNavigator;