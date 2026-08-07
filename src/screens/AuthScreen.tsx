import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'react-native';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { Toast, useToast } from '../components/Toast';
import { supabase } from '../services/supabase';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { sha256 } from 'js-sha256';
import { colors } from '../theme/colors';
import { useTranslation } from 'react-i18next';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '@env';
import { enforceOAuthSignupQuota, registerOAuthSignup, enforceSignupQuota } from '../utils/deviceId';
import BrandLoader from '../components/BrandLoader';

let appleAuth: any = null;
if (Platform.OS === 'ios') {
  appleAuth = require('@invertase/react-native-apple-authentication').default;
}

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  iosClientId: GOOGLE_IOS_CLIENT_ID,
});

const AuthScreen = () => {
  const [loading, setLoading] = useState(false);
  const { toast, showToast, dismissToast } = useToast();
  const { t } = useTranslation();

  const generateSecureNonce = (): string => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  };

  const mapAuthError = (msg: string) => {
    const m = (msg ?? '').toLowerCase();
    if (m.includes('rate limit')) return t('auth.errors.rateLimit', 'Trop de tentatives. Réessayez dans quelques minutes.');
    if (m.includes('device_signup_limit_reached')) return t('auth.errors.deviceSignupLimit', 'Trop de comptes créés avec ce téléphone. Veuillez réessayer ultérieurement.');
    // Double compte via un autre provider : le trigger handle_new_user viole
    // idx_profiles_email_normalized_unique (Google john.doe@gmail.com et Apple
    // johndoe@gmail.com donnent le même email normalisé), donc Supabase renvoie
    // une erreur DB opaque du genre « Database error saving new user ». On
    // oriente vers la méthode de connexion d'origine au lieu d'afficher ça.
    if (m.includes('email_normalized') || m.includes('duplicate key')
      || m.includes('database error saving new user')) {
      return t('auth.errors.accountExistsOtherProvider');
    }
    // Autres erreurs serveur : jamais le message brut Postgres/GoTrue à l'écran.
    if (m.includes('database error') || m.includes('unexpected_failure')) {
      return t('auth.errors.signupFailed');
    }
    return msg;
  };

  const checkNewUserQuota = async (createdAt: string) => {
    const isNewUser = (Date.now() - new Date(createdAt).getTime()) < 60_000;
    if (!isNewUser) return;

    // Barrière 1 — locale (Keychain, survit à la désinstallation). Gratuite et
    // disponible hors ligne, mais contournable : elle dissuade, elle n'arrête pas.
    // Google et Apple partagent ce compteur, c'est bien un cumul par appareil.
    try {
      await enforceOAuthSignupQuota();
    } catch {
      await supabase.auth.signOut();
      throw new Error('device_signup_limit_reached');
    }

    // Barrière 2 — serveur (table device_signups). C'est elle qui fait autorité :
    // le compte vit en base, pas dans le téléphone. Elle vérifie ET enregistre.
    try {
      await enforceSignupQuota();
    } catch (e: any) {
      if (e?.message === 'device_signup_limit_reached') {
        await supabase.auth.signOut();
        throw new Error('device_signup_limit_reached');
      }
      // Réseau coupé ou RPC indisponible : on ne bloque pas une inscription
      // légitime pour autant. La barrière locale a déjà fait son office.
      __DEV__ && console.warn('[AUTH] quota serveur indisponible', e?.message);
    }

    await registerOAuthSignup();
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const useNonce = Platform.OS === 'ios';
      const rawNonce = useNonce ? generateSecureNonce() : undefined;
      const hashedNonce = rawNonce ? sha256(rawNonce) : undefined;
      const userInfo = await (GoogleSignin.signIn as any)(
        useNonce ? { nonce: hashedNonce } : {},
      );
      const idToken = userInfo.data?.idToken;
      if (idToken) {
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
          ...(rawNonce ? { nonce: rawNonce } : {}),
        });
        if (error) throw error;
        if (data.user) await checkNewUserQuota(data.user.created_at);
      }
    } catch (error: any) {
      showToast({ type: 'error', title: t('auth.errors.googleTitle'), message: mapAuthError(error.message) });
    } finally {
      setLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    if (!appleAuth) return;
    setLoading(true);
    try {
      const rawNonce = generateSecureNonce();
      const hashedNonce = sha256(rawNonce);
      const appleAuthRequestResponse = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
        nonce: hashedNonce,
      });
      const { identityToken, fullName } = appleAuthRequestResponse;
      if (identityToken) {
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: identityToken,
          nonce: rawNonce,
        });
        if (error) throw error;
        if (data.user) {
          const isNewUser = (Date.now() - new Date(data.user.created_at).getTime()) < 60_000;
          if (isNewUser) {
            await checkNewUserQuota(data.user.created_at);
            const displayName = [fullName?.givenName, fullName?.familyName].filter(Boolean).join(' ');
            if (displayName) {
              await supabase.auth.updateUser({ data: { full_name: displayName } });
            }
          }
        }
      }
    } catch (error: any) {
      if (error?.code === appleAuth.Error.CANCELED) return;
      showToast({ type: 'error', title: t('auth.errors.appleTitle'), message: mapAuthError(error.message) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <Toast data={toast} onDismiss={dismissToast} bottomOffset={40} />

      <View style={styles.hero}>
        <Image
          source={require('../assets/strive-logo.png')}
          style={styles.logoImg}
        />

        <View style={styles.appNameWrap}>
          <Text style={styles.appName}>Strive</Text>
          <View style={styles.appNameLine} />
        </View>
      </View>

      <View style={styles.actions}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <BrandLoader size={12} />
            <Text style={styles.loadingText}>{t('auth.connecting')}</Text>
          </View>
        ) : (
          <>
            {/* Google — iOS + Android */}
            <TouchableOpacity style={styles.btnGoogle} onPress={handleGoogleLogin} activeOpacity={0.85}>
              <View style={styles.googleIconWrap}>
                <FontAwesome name="google" size={17} color="#4285F4" />
              </View>
              <Text style={styles.btnGoogleText}>{t('auth.continueGoogle')}</Text>
            </TouchableOpacity>

            {/* Apple — iOS uniquement */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity style={styles.btnApple} onPress={handleAppleLogin} activeOpacity={0.85}>
                <FontAwesome name="apple" size={20} color="#fff" />
                <Text style={styles.btnAppleText}>{t('auth.continueApple')}</Text>
              </TouchableOpacity>
            )}

            {/* Facebook — iOS + Android (à activer après config Facebook Developer)
            <TouchableOpacity style={styles.btnFacebook} onPress={handleFacebookLogin} activeOpacity={0.85}>
              <FontAwesome name="facebook" size={18} color="#fff" />
              <Text style={styles.btnFacebookText}>{t('auth.continueFacebook', 'Continuer avec Facebook')}</Text>
            </TouchableOpacity>
            */}
          </>
        )}

        {/* Ces deux libellés étaient stylés en lien mais sans `onPress` : verts,
            en gras, et inertes. Les mêmes URL sont déjà ouvertes depuis
            ProfileScreen — c'est aussi ce qu'attend la revue App Store sur un
            écran de création de compte. */}
        <Text style={styles.footer}>
          {t('auth.termsText')}{' '}
          <Text
            style={styles.footerLink}
            onPress={() => Linking.openURL('https://striveapp.fr/terms')}
            accessibilityRole="link"
          >
            {t('auth.termsLink')}
          </Text>
          {' '}{t('auth.andText')}{' '}
          <Text
            style={styles.footerLink}
            onPress={() => Linking.openURL('https://striveapp.fr/privacy')}
            accessibilityRole="link"
          >
            {t('auth.privacyLink')}
          </Text>
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
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  logoImg: {
    width: 80,
    height: 80,
    borderRadius: 20,
  },
  appNameWrap: {
    alignItems: 'center',
  },
  appName: {
    fontSize: 48,
    fontWeight: '900',
    color: colors.textMain,
    letterSpacing: -1.5,
  },
  appNameLine: {
    width: 60,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
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
  btnApple: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#000000',
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    // #000 sur un fond #0A120E : sans bordure lisible, le bouton se fond dans la
    // page et on ne voit plus que son texte. Le blanc étant déjà pris par Google,
    // on garde le noir (autorisé par les règles Apple) et on dessine le contour.
    borderColor: 'rgba(255,255,255,0.22)',
  },
  btnAppleText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  btnFacebook: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1877F2',
    height: 54,
    borderRadius: 14,
  },
  btnFacebookText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  footer: {
    color: colors.textDimmed,
    // 11px était sous le seuil de confort pour un texte que l'utilisateur doit
    // pouvoir lire ET toucher ; l'interligne élargit aussi la zone tactile des
    // deux liens, qui sont imbriqués dans la phrase.
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 16,
  },
  footerLink: {
    color: colors.primary,
    fontWeight: '600',
  },
});

export default AuthScreen;
