import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { Toast, useToast } from '../components/Toast';
import { supabase } from '../services/supabase';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { sha256 } from 'js-sha256';
import appleAuth from '@invertase/react-native-apple-authentication';
import { colors } from '../theme/colors';
import { useTranslation } from 'react-i18next';

GoogleSignin.configure({
  webClientId: '397785965149-4gq72k418u7cd5rhf4mmkbvof2nclqsl.apps.googleusercontent.com',
  iosClientId: '397785965149-7at5j010btil8a2vfbq6i3s7snu1ob15.apps.googleusercontent.com',
});

const AuthScreen = () => {
  const [loading, setLoading] = useState(false);
  const { toast, showToast, dismissToast } = useToast();
  const { t } = useTranslation();

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const rawNonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const hashedNonce = sha256(rawNonce);
      const userInfo = await (GoogleSignin.signIn as any)({ nonce: hashedNonce });
      const idToken = userInfo.data?.idToken;
      if (idToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
          nonce: rawNonce,
        });
        if (error) throw error;
      }
    } catch (error: any) {
      showToast({ type: 'error', title: t('auth.errors.googleTitle'), message: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setLoading(true);
    try {
      const appleAuthRequestResponse = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
      });
      const { identityToken } = appleAuthRequestResponse;
      if (identityToken) {
        const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken });
        if (error) throw error;
      }
    } catch (error: any) {
      showToast({ type: 'error', title: t('auth.errors.appleTitle'), message: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <Toast data={toast} onDismiss={dismissToast} bottomOffset={40} />

      {/* ── LOGO + NOM ── */}
      <View style={styles.hero}>
        <LinearGradient
          colors={['rgba(0,230,118,0.18)', 'rgba(0,230,118,0.04)']}
          style={styles.logoWrap}
        >
          <MaterialCommunityIcons name="steering" size={40} color={colors.primary} />
        </LinearGradient>

        <Text style={styles.appName}>
          Str<Text style={styles.appNameGreen}>ive</Text>
        </Text>
      </View>

      {/* ── BOUTONS ── */}
      <View style={styles.actions}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>{t('auth.connecting')}</Text>
          </View>
        ) : (
          <>
            {/* Google */}
            <TouchableOpacity style={styles.btnGoogle} onPress={handleGoogleLogin} activeOpacity={0.85}>
              <View style={styles.googleIconWrap}>
                <FontAwesome name="google" size={17} color="#4285F4" />
              </View>
              <Text style={styles.btnGoogleText}>{t('auth.continueGoogle')}</Text>
            </TouchableOpacity>

            {/* Apple */}
            <TouchableOpacity style={styles.btnApple} onPress={handleAppleLogin} activeOpacity={0.85}>
              <FontAwesome name="apple" size={20} color="#fff" />
              <Text style={styles.btnAppleText}>{t('auth.continueApple')}</Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={styles.footer}>
          {t('auth.termsText')}{' '}
          <Text style={styles.footerLink}>{t('auth.termsLink')}</Text>
          {' '}{t('auth.andText')}{' '}
          <Text style={styles.footerLink}>{t('auth.privacyLink')}</Text>
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
  },

  /* Hero — prend tout l'espace disponible au centre */
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.2)',
  },
  appName: {
    fontSize: 48,
    fontWeight: '900',
    color: colors.textMain,
    letterSpacing: -1.5,
  },
  appNameGreen: {
    color: colors.primary,
  },

  /* Boutons en bas */
  actions: {
    paddingBottom: 32,
    gap: 12,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
  },

  /* Google — blanc officiel */
  btnGoogle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    height: 54,
    borderRadius: 14,
  },
  googleIconWrap: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnGoogleText: {
    color: '#3C4043',
    fontSize: 15,
    fontWeight: '600',
  },

  /* Apple — noir officiel */
  btnApple: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#000000',
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  btnAppleText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },

  footer: {
    color: colors.textDimmed,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 4,
  },
  footerLink: {
    color: colors.primary,
    fontWeight: '600',
  },
});

export default AuthScreen;
