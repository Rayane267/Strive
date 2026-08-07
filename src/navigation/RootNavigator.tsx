import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import OnboardingScreenRaw from '../screens/OnboardingScreen';
import HelpScreenRaw from '../screens/HelpScreen';
import SupportTicketsScreenRaw from '../screens/SupportTicketsScreen';
import SupportTicketDetailScreenRaw from '../screens/SupportTicketDetailScreen';
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
const SupportTicketsScreen = withErrorBoundary(SupportTicketsScreenRaw);
const SupportTicketDetailScreen = withErrorBoundary(SupportTicketDetailScreenRaw);
const ResetPasswordScreen = withErrorBoundary(ResetPasswordScreenRaw);

const Stack = createNativeStackNavigator();

const TUTORIAL_SEEN_KEY = '@strive_has_seen_tutorial';
const ONBOARDING_SEEN_KEY = '@strive_has_seen_onboarding';

const RootNavigator = () => {
  const { user, profile, loading, profileError, refreshProfile } = useAuth();
  const { t } = useTranslation();
  const [tutorialChecked, setTutorialChecked] = useState(false);
  const [showTutorialFirst, setShowTutorialFirst] = useState(false);
  // L'onboarding (objectif, heures, charges, statut) précède le tutoriel : il
  // produit le seuil de rentabilité, le tutoriel apprend ensuite le geste et fait
  // installer le raccourci. Deux clés distinctes — le tutoriel reste rejouable
  // depuis le Profil sans redemander les chiffres.
  const [showOnboardingFirst, setShowOnboardingFirst] = useState(false);

  useEffect(() => {
    if (!user || !profile?.first_name) {
      setTutorialChecked(true);
      return;
    }
    Promise.all([
      AsyncStorage.getItem(ONBOARDING_SEEN_KEY),
      AsyncStorage.getItem(TUTORIAL_SEEN_KEY),
    ]).then(([onb, tuto]) => {
      if (onb !== '1') setShowOnboardingFirst(true);
      if (tuto !== '1') setShowTutorialFirst(true);
      setTutorialChecked(true);
    });
  }, [user, profile?.first_name]);

  if (loading || (user && profile === null && !profileError) || (user && profile?.first_name && !tutorialChecked)) {
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
          {showOnboardingFirst && (
            <Stack.Screen
              name="Onboarding"
              options={{ headerShown: false, animation: 'fade' }}
            >
              {(props: any) => (
                <OnboardingScreenRaw
                  {...props}
                  onFinish={() => {
                    AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
                    setShowOnboardingFirst(false);
                    // Les seuils viennent d'être écrits en base : on rafraîchit le
                    // profil pour que le Dashboard et le natif les voient tout de suite.
                    refreshProfile?.();
                  }}
                />
              )}
            </Stack.Screen>
          )}

          {showTutorialFirst && (
            <Stack.Screen
              name="TutorialOnboarding"
              options={{ headerShown: false, animation: 'fade' }}
            >
              {(props: any) => (
                <TutorialScreenRaw
                  {...props}
                  onFinish={() => {
                    AsyncStorage.setItem(TUTORIAL_SEEN_KEY, '1');
                    setShowTutorialFirst(false);
                  }}
                />
              )}
            </Stack.Screen>
          )}
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

          <Stack.Screen
            name="SupportTickets"
            component={SupportTicketsScreen}
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />

          <Stack.Screen
            name="SupportTicketDetail"
            component={SupportTicketDetailScreen}
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