import React from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';

// Imports des écrans
import TabNavigator from './TabNavigator';
import AuthScreen from '../screens/AuthScreen';
import CarSettingsScreen from '../screens/CarSettingsScreen';
import AccountInfoScreen from '../screens/AccountInfoScreen';
import UpgradeScreen from '../screens/UpgradeScreen';
import PreferencesScreen from '../screens/PreferencesScreen.tsx';
import ProfileSetupScreen from '../screens/ProfileSetupScreen.tsx';
import SubscriptionScreen from '../screens/SubscriptionScreen.tsx';
import ScannerPermissionScreen from '../screens/ScannerPermissionScreen';
import TutorialScreen from '../screens/TutorialScreen';
import HelpScreen from '../screens/HelpScreen';

const Stack = createNativeStackNavigator();

const RootNavigator = () => {
  const { user, profile, loading, profileError, refreshProfile } = useAuth();
  const { t } = useTranslation();

  if (loading || (user && profile === null && !profileError)) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#0A120E',
        }}
      >
        <ActivityIndicator size="large" color="#00E676" />
      </View>
    );
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
        <Stack.Screen
          name="Auth"
          component={AuthScreen}
          options={{ headerShown: false }}
        />
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
            name="Upgrade"
            component={UpgradeScreen}
            options={{ presentation: 'modal', headerShown: false }}
          />

          <Stack.Screen
            name="SubscriptionScreen"
            component={SubscriptionScreen}
            options={{
              headerShown: false,
              presentation: 'modal',
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