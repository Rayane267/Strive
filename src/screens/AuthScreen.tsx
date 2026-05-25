import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SafeGradient from '../components/SafeGradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import Feather from 'react-native-vector-icons/Feather';
import { Toast, useToast } from '../components/Toast';
import { supabase } from '../services/supabase';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { sha256 } from 'js-sha256';
import appleAuth from '@invertase/react-native-apple-authentication';
import { colors } from '../theme/colors';
import { useTranslation } from 'react-i18next';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '@env';
import { enforceSignupQuota, enforceOAuthSignupQuota, registerOAuthSignup } from '../utils/deviceId';
import BrandLoader from '../components/BrandLoader';

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  iosClientId: GOOGLE_IOS_CLIENT_ID,
});

type Mode = 'idle' | 'login' | 'signup' | 'reset';

const AuthScreen = () => {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { toast, showToast, dismissToast } = useToast();
  const { t } = useTranslation();

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
  const isStrongEnough = (p: string) => p.length >= 8;

  const generateSecureNonce = (): string => {
    const bytes = new Uint8Array(32);
    // crypto exposé par react-native-url-polyfill/auto importé dans services/supabase.ts
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  };

  const mapAuthError = (msg: string) => {
    const m = msg.toLowerCase();
    if (m.includes('disposable_email_not_allowed')) return t('auth.errors.disposable', 'Adresse email jetable non autorisée');
    if (m.includes('invalid login') || m.includes('invalid credentials')) return t('auth.errors.invalidCreds', 'Email ou mot de passe incorrect');
    if (m.includes('email not confirmed')) return t('auth.errors.notConfirmed', 'Confirmez votre email avant de vous connecter');
    if (m.includes('user already registered') || m.includes('already exists') || m.includes('duplicate')) return t('auth.errors.alreadyExists', 'Un compte existe déjà avec cet email');
    if (m.includes('rate limit')) return t('auth.errors.rateLimit', 'Trop de tentatives. Réessayez dans quelques minutes.');
    if (m.includes('weak password')) return t('auth.errors.weakPassword', 'Mot de passe trop faible (minimum 8 caractères)');
    if (m.includes('device_signup_limit_reached')) return t('auth.errors.deviceSignupLimit', 'Trop de comptes créés avec ce téléphone. Veuillez réessayer ultérieurement.');
    if (m.includes('signup_quota_check_failed')) return t('auth.errors.signupQuotaCheckFailed', 'Impossible de vérifier votre device. Vérifiez votre connexion et réessayez.');
    return msg;
  };

  const handleEmailSignup = async () => {
    if (!isValidEmail(email)) {
      showToast({ type: 'error', title: t('auth.errors.signupTitle', 'Inscription'), message: t('auth.errors.invalidEmail', 'Email invalide') });
      return;
    }
    if (!isStrongEnough(password)) {
      showToast({ type: 'error', title: t('auth.errors.signupTitle', 'Inscription'), message: t('auth.errors.weakPassword', 'Mot de passe trop faible (minimum 8 caractères)') });
      return;
    }
    setLoading(true);
    try {
      // Quota device : max 5 signups par device sur fenêtre rolling 60j.
      // Throw 'device_signup_limit_reached' si dépassé → on n'envoie même
      // pas la requête signUp à Supabase Auth.
      await enforceSignupQuota();

      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
      // Si confirm email actif → user créé mais session null tant que l'email n'est pas vérifié
      if (data.user && !data.session) {
        showToast({
          type: 'success',
          title: t('auth.signupSuccessTitle', 'Inscription réussie'),
          message: t('auth.checkEmail', 'Vérifiez votre email pour confirmer votre compte'),
        });
        setMode('login');
        setPassword('');
      }
      // Si data.session existe (confirm email désactivé), AuthContext prend
      // le relais via onAuthStateChange — rien à faire ici.
    } catch (e: any) {
      showToast({ type: 'error', title: t('auth.errors.signupTitle', 'Inscription'), message: mapAuthError(e?.message ?? '') });
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async () => {
    if (!isValidEmail(email) || !password) {
      showToast({ type: 'error', title: t('auth.errors.loginTitle', 'Connexion'), message: t('auth.errors.fillAllFields', 'Renseignez tous les champs') });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
    } catch (e: any) {
      showToast({ type: 'error', title: t('auth.errors.loginTitle', 'Connexion'), message: mapAuthError(e?.message ?? '') });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!isValidEmail(email)) {
      showToast({ type: 'error', title: t('auth.errors.resetTitle', 'Réinitialisation'), message: t('auth.errors.invalidEmail', 'Email invalide') });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: 'strive://reset-password',
      });
      if (error) throw error;
      showToast({
        type: 'success',
        title: t('auth.resetSentTitle', 'Email envoyé'),
        message: t('auth.resetSent', 'Vérifiez votre boîte mail pour réinitialiser votre mot de passe'),
      });
      setMode('login');
    } catch (e: any) {
      showToast({ type: 'error', title: t('auth.errors.resetTitle', 'Réinitialisation'), message: mapAuthError(e?.message ?? '') });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      // Nonce is only supported on iOS (native patch). Android's legacy
      // GMS GoogleSignIn API ignores it, which causes Supabase token
      // verification to fail. So we only use nonce on iOS.
      const useNonce = Platform.OS === 'ios';
      // CSPRNG via crypto.getRandomValues (polyfillé par react-native-url-polyfill/auto).
      // Indispensable pour un nonce anti-replay : Math.random est prédictible.
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
        const isNewUser = data.user &&
          (Date.now() - new Date(data.user.created_at).getTime()) < 60_000;
        if (isNewUser) {
          try {
            await enforceOAuthSignupQuota();
            await registerOAuthSignup();
          } catch {
            await supabase.auth.signOut();
            throw new Error('device_signup_limit_reached');
          }
        }
      }
    } catch (error: any) {
      showToast({ type: 'error', title: t('auth.errors.googleTitle'), message: mapAuthError(error.message) });
    } finally {
      setLoading(false);
    }
  };

  const handleAppleLogin = async () => {
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
        const isNewUser = data.user &&
          (Date.now() - new Date(data.user.created_at).getTime()) < 60_000;
        if (isNewUser) {
          try {
            await enforceOAuthSignupQuota();
            await registerOAuthSignup();
          } catch {
            await supabase.auth.signOut();
            throw new Error('device_signup_limit_reached');
          }
          const displayName = [fullName?.givenName, fullName?.familyName].filter(Boolean).join(' ');
          if (displayName) {
            await supabase.auth.updateUser({ data: { full_name: displayName } });
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

      {/* ── LOGO + NOM ── */}
      <View style={styles.hero}>
        <SafeGradient
          colors={['rgba(0,230,118,0.18)', 'rgba(0,230,118,0.04)']}
          style={styles.logoWrap}
        >
          <MaterialCommunityIcons name="steering" size={40} color={colors.primary} />
        </SafeGradient>

        <Text style={styles.appName}>
          Str<Text style={styles.appNameGreen}>ive</Text>
        </Text>
      </View>

      {/* ── BOUTONS ── */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.actions}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <BrandLoader size={12} />
            <Text style={styles.loadingText}>{t('auth.connecting')}</Text>
          </View>
        ) : mode === 'idle' ? (
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

            {/* Séparateur */}
            <View style={styles.separator}>
              <View style={styles.separatorLine} />
              <Text style={styles.separatorText}>{t('auth.or', 'ou')}</Text>
              <View style={styles.separatorLine} />
            </View>

            {/* Email */}
            <TouchableOpacity style={styles.btnEmail} onPress={() => setMode('login')} activeOpacity={0.85}>
              <Feather name="mail" size={18} color={colors.textMain} />
              <Text style={styles.btnEmailText}>{t('auth.continueEmail', 'Continuer avec email')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
            {/* Header retour */}
            <TouchableOpacity onPress={() => { setMode('idle'); setPassword(''); }} style={styles.backBtn}>
              <Feather name="chevron-left" size={20} color={colors.textMain} />
              <Text style={styles.backText}>
                {mode === 'signup' && t('auth.signup', 'Créer un compte')}
                {mode === 'login' && t('auth.login', 'Connexion')}
                {mode === 'reset' && t('auth.resetTitle', 'Réinitialiser le mot de passe')}
              </Text>
            </TouchableOpacity>

            {/* Email */}
            <View style={styles.inputWrap}>
              <Feather name="mail" size={16} color={colors.textDimmed} />
              <TextInput
                style={styles.input}
                placeholder={t('auth.emailPlaceholder', 'Votre adresse email')}
                placeholderTextColor={colors.textDimmed}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
              />
            </View>

            {/* Password (sauf en mode reset) */}
            {mode !== 'reset' && (
              <View style={styles.inputWrap}>
                <Feather name="lock" size={16} color={colors.textDimmed} />
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.passwordPlaceholder', 'Mot de passe')}
                  placeholderTextColor={colors.textDimmed}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={mode === 'signup' ? 'password-new' : 'password'}
                  textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                />
                <TouchableOpacity onPress={() => setShowPassword(s => !s)}>
                  <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color={colors.textDimmed} />
                </TouchableOpacity>
              </View>
            )}

            {/* CTA principal */}
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={mode === 'signup' ? handleEmailSignup : mode === 'login' ? handleEmailLogin : handleResetPassword}
              activeOpacity={0.85}
            >
              <Text style={styles.btnPrimaryText}>
                {mode === 'signup' && t('auth.signupCta', "S'inscrire")}
                {mode === 'login' && t('auth.loginCta', 'Se connecter')}
                {mode === 'reset' && t('auth.resetCta', "Envoyer l'email")}
              </Text>
            </TouchableOpacity>

            {/* Liens secondaires */}
            <View style={styles.linksRow}>
              {mode === 'login' && (
                <>
                  <TouchableOpacity onPress={() => setMode('reset')}>
                    <Text style={styles.linkText}>{t('auth.forgotPassword', 'Mot de passe oublié ?')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setMode('signup'); setPassword(''); }}>
                    <Text style={styles.linkText}>{t('auth.noAccount', "Pas encore de compte ?")}</Text>
                  </TouchableOpacity>
                </>
              )}
              {mode === 'signup' && (
                <TouchableOpacity onPress={() => { setMode('login'); setPassword(''); }}>
                  <Text style={styles.linkText}>{t('auth.haveAccount', 'Déjà un compte ? Se connecter')}</Text>
                </TouchableOpacity>
              )}
              {mode === 'reset' && (
                <TouchableOpacity onPress={() => setMode('login')}>
                  <Text style={styles.linkText}>{t('auth.backToLogin', 'Retour à la connexion')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        )}

        {mode === 'idle' && (
          <Text style={styles.footer}>
            {t('auth.termsText')}{' '}
            <Text style={styles.footerLink}>{t('auth.termsLink')}</Text>
            {' '}{t('auth.andText')}{' '}
            <Text style={styles.footerLink}>{t('auth.privacyLink')}</Text>
          </Text>
        )}
      </KeyboardAvoidingView>
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

  separator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  separatorText: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '500',
  },

  btnEmail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  btnEmailText: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '600',
  },

  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  backText: {
    color: colors.textMain,
    fontSize: 16,
    fontWeight: '700',
  },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  input: {
    flex: 1,
    color: colors.textMain,
    fontSize: 15,
    padding: 0,
  },

  btnPrimary: {
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    marginTop: 4,
  },
  btnPrimaryText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '700',
  },

  linksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 6,
  },
  linkText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '500',
  },
});

export default AuthScreen;
