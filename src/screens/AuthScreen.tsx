import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  StatusBar,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Toast, useToast } from '../components/Toast';
import BrandLoader from '../components/BrandLoader';
import { supabase } from '../services/supabase';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { sha256 } from 'js-sha256';
import { colors } from '../theme/colors';
import { useTranslation } from 'react-i18next';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '@env';
import { enforceOAuthSignupQuota, registerOAuthSignup, enforceSignupQuota } from '../utils/deviceId';

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

  /**
   * Empreinte de l'identité, partagée par les deux barrières.
   *
   * Normalisée avant hachage (minuscules, espaces retirés) pour que le même
   * compte hache pareil d'un fournisseur à l'autre et d'une session à l'autre —
   * sinon un retour légitime ne serait pas reconnu comme tel. Miroir de
   * `normalize_email` côté SQL pour la casse ; on ne va pas plus loin (les
   * alias `+` de Gmail restent des identités distinctes ici, c'est le rôle de
   * l'index unique sur `email_normalized` de les rapprocher).
   */
  const identityHash = (email?: string | null): string | undefined => {
    const e = (email ?? '').trim().toLowerCase();
    return e ? sha256(e) : undefined;
  };

  const checkNewUserQuota = async (createdAt: string, email?: string | null) => {
    const isNewUser = (Date.now() - new Date(createdAt).getTime()) < 60_000;
    if (!isNewUser) return;

    // L'empreinte fait la différence entre une NOUVELLE inscription et un
    // RETOUR. Un chauffeur qui a supprimé son compte et revient avec la même
    // adresse ne consomme aucun slot et n'est jamais refusé : sans ça, il était
    // renvoyé sur la page de connexion au troisième aller-retour, pour avoir
    // exercé un droit qu'on lui doit.
    const hash = identityHash(email);

    // Barrière 1 — locale (Keychain, survit à la désinstallation). Gratuite et
    // disponible hors ligne, mais contournable : elle dissuade, elle n'arrête pas.
    // Google et Apple partagent ce compteur, c'est bien un cumul par appareil.
    try {
      await enforceOAuthSignupQuota(hash);
    } catch {
      await supabase.auth.signOut();
      throw new Error('device_signup_limit_reached');
    }

    // Barrière 2 — serveur (table device_signups). C'est elle qui fait autorité :
    // le compte vit en base, pas dans le téléphone. Elle vérifie ET enregistre.
    try {
      await enforceSignupQuota(hash);
    } catch (e: any) {
      if (e?.message === 'device_signup_limit_reached') {
        await supabase.auth.signOut();
        throw new Error('device_signup_limit_reached');
      }
      // Réseau coupé ou RPC indisponible : on ne bloque pas une inscription
      // légitime pour autant. La barrière locale a déjà fait son office.
      __DEV__ && console.warn('[AUTH] quota serveur indisponible', e?.message);
    }

    await registerOAuthSignup(hash);
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
        if (data.user) await checkNewUserQuota(data.user.created_at, data.user.email);
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
            await checkNewUserQuota(data.user.created_at, data.user.email);
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

      {/* Identité en haut, actions en bas : le pouce ne remonte pas chercher un
          bouton de connexion, et le vide entre les deux laisse la marque
          respirer au premier lancement. */}
      <View style={styles.hero}>
        <Image source={require('../assets/strive-logo.png')} style={styles.logoImg} />
        <View style={styles.wordmarkWrap}>
          <Text style={styles.wordmark}>Strive</Text>
          <View style={styles.wordmarkLine} />
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
            {/* Boutons dessinés par nous mais portant les marques officielles,
                reprises telles quelles des kits Apple et Google (src/assets/icons).
                Un logo redessiné ou emprunté à une police d'icônes est un motif
                de rejet côté Apple et une violation des règles d'identité côté
                Google. La pilule Google est calée sur #F2F2F2, la couleur que
                Google impose à sa variante claire, si bien que le fond de la
                tuile s'y fond sans raccord visible. */}
            <TouchableOpacity
              style={styles.btnGoogle}
              onPress={handleGoogleLogin}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('auth.continueGoogle')}
            >
              <Image
                // Recadrée sur le glyphe : la tuile d'origine entourait le « G »
                // d'une marge qui occupait la moitié de l'image, si bien qu'à
                // 22 pt le logo n'en faisait plus qu'une dizaine et se voyait à
                // peine. Le fond #F2F2F2 est conservé — il est identique à celui
                // de la pilule, donc invisible.
                source={require('../assets/icons/google-logo.png')}
                style={styles.brandIcon}
                resizeMode="contain"
              />
              <Text style={styles.btnGoogleText}>{t('auth.continueGoogle')}</Text>
            </TouchableOpacity>

            {/* Apple — iOS uniquement : le SDK n'existe pas sur Android, afficher
                le bouton y mènerait à un bouton mort. */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.btnApple}
                onPress={handleAppleLogin}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('auth.continueApple')}
              >
                <Image
                  // Copie sans suffixe de densité : Metro lit « @3x » comme une
                  // variante et cherche alors un fichier de base qui n'existe
                  // pas dans le kit Apple, d'où un échec de résolution au bundle.
                  source={require('../assets/icons/apple-logo-white.png')}
                  style={styles.appleIcon}
                  resizeMode="contain"
                />
                <Text style={styles.btnAppleText}>{t('auth.continueApple')}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

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
    gap: 18,
  },
  logoImg: { width: 88, height: 88, borderRadius: 22 },
  wordmarkWrap: { alignItems: 'center' },
  wordmark: {
    fontSize: 48,
    fontWeight: '900',
    color: colors.textMain,
    letterSpacing: -1.5,
  },
  wordmarkLine: {
    width: 60,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  actions: { paddingBottom: 32, gap: 12 },
  loadingWrap: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  loadingText: { color: colors.textMuted, fontSize: 14 },

  // Deux pilules de gabarit identique : hauteur 58 (au-dessus des 44 pt de cible
  // tactile minimale, confortable pour un pouce) et rayon plein.
  btnGoogle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 58,
    borderRadius: 29,
    // Blanc cerné d'un filet gris — l'autre variante claire autorisée par les
    // règles d'identité de Google. Le logo a été détouré pour l'occasion : sa
    // plaque #F2F2F2 se serait vue comme un carré gris sur du blanc.
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DADCE0',
  },
  // Texte gris très sombre, également prescrit par Google — pas du noir pur.
  btnGoogleText: { color: '#1F1F1F', fontSize: 16, fontWeight: '700' },
  btnApple: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#000000',
  },
  btnAppleText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  brandIcon: { width: 22, height: 22 },
  appleIcon: { width: 18, height: 22 },

  footer: {
    color: colors.textDimmed,
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 16,
  },
  footerLink: { color: colors.primary, fontWeight: '600' },
});

export default AuthScreen;
