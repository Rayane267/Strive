import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SplashScreen from '../components/SplashScreen';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import { getEffectivePlanTier } from '../services/subscriptionService';
import { grantWelcomeCredits } from '../utils/deviceId';
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
import DiagnosticsScreen from '../screens/DiagnosticsScreen';
import WelcomeGiftScreen from '../screens/WelcomeGiftScreen';
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
        {/* Porte de sortie. Sans elle, cet écran est un cul-de-sac : « Réessayer »
            ne répare rien quand la cause n'est pas passagère, et la session vit
            dans le Keychain, qui SURVIT à la désinstallation de l'app. Un
            chauffeur dont le compte a disparu restait enfermé ici à vie, sans
            aucun geste possible. Se déconnecter le ramène à l'écran de
            connexion, d'où tout est de nouveau accessible. */}
        <TouchableOpacity
          onPress={() => { supabase.auth.signOut({ scope: 'local' }).catch(() => {}); }}
          style={{ paddingHorizontal: 24, paddingVertical: 12 }}
        >
          <Text style={{ color: '#8F9B96', fontSize: 14, textDecorationLine: 'underline' }}>
            {t('profile.logout', 'Déconnexion')}
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
                  onFinish={(opts?: { openPaywall?: boolean }) => {
                    AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
                    setShowOnboardingFirst(false);
                    // Les seuils viennent d'être écrits en base : on rafraîchit le
                    // profil pour que le Dashboard et le natif les voient tout de suite.
                    //
                    // Le cadeau de bienvenue (30 scans, 1 fois par appareil) est
                    // accordé AVANT ce refresh, sans quoi le Dashboard afficherait
                    // un solde d'un temps de retard. `grantWelcomeCredits` ne lève
                    // jamais et ne bloque rien : un refus (appareil déjà servi) ou
                    // une panne réseau laissent l'onboarding se terminer comme si
                    // de rien n'était, et le refresh a lieu dans les deux cas.
                    //
                    // Le paywall s'ouvre dans la foulée, tant que le seuil
                    // verrouillé est encore présent à l'esprit. Le tutoriel vient
                    // ensuite : c'est le seul moment du parcours où le chauffeur
                    // a une raison précise de s'abonner plutôt qu'une promesse.
                    // `openPaywall: false` = le chauffeur a explicitement pris
                    // « continuer sans ». Absent = comportement d'origine, on
                    // ouvre. Lui reproposer le paywall qu'il vient de refuser
                    // serait le seul moment du parcours où l'app insiste.
                    const wantsPaywall =
                      opts?.openPaywall !== false && getEffectivePlanTier(profile) === 'free';

                    // Quand le cadeau tombe, son annonce s'intercale AVANT le
                    // paywall et se charge de l'ouvrir ensuite : le chauffeur doit
                    // savoir ce qu'il vient de recevoir avant qu'on lui parle de
                    // payer, sinon l'offre arrive sur quelqu'un qui ignore encore
                    // ce qu'il possède.
                    grantWelcomeCredits().then(gift => {
                      refreshProfile?.();
                      if (gift) {
                        props.navigation.navigate('WelcomeGift', {
                          amount: gift.amount,
                          expiresInDays: gift.expiresInDays,
                          thenPaywall: wantsPaywall,
                        });
                      } else if (wantsPaywall) {
                        props.navigation.navigate('SubscriptionScreen');
                      }
                    });
                  }}
                />
              )}
            </Stack.Screen>
          )}

          {showTutorialFirst && (
            <Stack.Screen
              name="TutorialOnboarding"
              // Même présentation que le tutoriel rejouable depuis le Profil :
              // il monte du bas comme une feuille. Le fondu d'avant le faisait
              // apparaître sur place, sans dire d'où il venait ni qu'on peut le
              // refermer.
              options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }}
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
          {/* L'écran n'est pas seulement caché du menu : il n'est pas ENREGISTRÉ
              hors dev/admin. Masquer l'entrée du Profil ne suffirait pas — un
              `navigate('Diagnostics')`, un deep link ou une restauration d'état
              l'ouvriraient quand même. Ici, la route n'existe pas. */}
          {(__DEV__ || profile?.is_admin) && (
            <Stack.Screen
              name="Diagnostics"
              component={DiagnosticsScreen}
              options={{ headerShown: false }}
            />
          )}
          {/* `fullScreenModal` et non `transparentModal` : l'écran qui vit
              derrière à ce moment du parcours est le TUTORIEL, pas le Dashboard.
              En transparent on lisait ses textes au travers, en concurrence avec
              le chiffre annoncé. Le fondu reste — rien n'arrive par-dessus,
              quelque chose s'allume. */}
          <Stack.Screen
            name="WelcomeGift"
            component={WelcomeGiftScreen}
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              animation: 'fade',
              // Le geste de retour est coupé : l'écran enchaîne sur le paywall
              // à sa sortie, et une sortie latérale sauterait ce chaînage.
              gestureEnabled: false,
            }}
          />
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