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
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { strokeWidth } from '../theme/stroke';
import { useTranslation } from 'react-i18next';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '@env';
import {
  enforceOAuthSignupQuota,
  registerOAuthSignup,
  enforceSignupQuota,
} from '../utils/deviceId';
import { FIELD_TOP } from '../theme/field';
import SafeGradient from '../components/SafeGradient';

/**
 * Le champ de l'écran de connexion : la lumière vient du HAUT.
 *
 * `ScreenField` éclaire par le bas, et c'est le bon sens pour les écrans de
 * l'app — la couleur arrive là où le pouce travaille et où le regard revient
 * (`src/theme/field.ts` raconte l'essai qui a tranché). Cet écran-ci n'est pas
 * de ceux-là : rien n'y défile, il n'y a pas de pouce qui revient, et il se
 * regarde comme une affiche. L'œil s'y pose en haut, sur la marque, avant de
 * descendre vers les boutons. La lumière suit ce trajet.
 *
 * Ce n'est donc PAS un retournement de la règle du champ, c'est un cas à part,
 * et il n'existe qu'ici.
 *
 * ── Les valeurs viennent d'une MESURE de la référence, pas d'une estimation ──
 *
 * Le canal dominant a été relevé sur toute la hauteur de l'écran de référence,
 * colonne par colonne. Trois choses en sortent, et les trois contredisent ce
 * qu'on croit voir :
 *
 *   1. La lueur MEURT À 42 % de la hauteur, pas aux deux tiers. En dessous, le
 *      noir est franc et neutre (#0F0F0F relevé) — c'est ce qui donne leur
 *      assise aux pilules de connexion.
 *   2. La lueur est HORIZONTALE. Les lignes d'égale intensité sont plates : la
 *      chute est verticale, et la largeur ne porte qu'une modulation douce,
 *      relevée par déciles à mi-lueur —
 *
 *        x     0,05  0,15  0,25  0,35  0,45  0,55  0,65  0,75  0,85  0,95
 *        ratio 0,58  0,71  0,69  0,55  0,59  0,66  0,72  0,81  0,96  1,00
 *
 *      soit 1,7× entre les deux bords, ÉTALÉ SUR TOUTE LA LARGEUR. Ce n'est pas
 *      une source ponctuelle en coin : la moitié gauche est un plateau, et la
 *      remontée ne se fait que dans le tiers droit.
 *   3. La lueur SE DÉSATURE vers son cœur : les canaux mineurs passent de 36 %
 *      du dominant en bas de la lueur à 55 % en haut. C'est une source qui vire
 *      au blanc, pas un aplat de couleur éclairci. Chaque arrêt ci-dessous porte
 *      donc sa propre saturation, relevée à sa hauteur.
 *
 *   4. Le haut est un PLATEAU. De 0 à 6 % la référence ne bouge quasiment pas
 *      (122 puis 125 en luminance), et la chute ne commence qu'après. Un
 *      dégradé qui part de son maximum au tout premier pixel et décroît
 *      aussitôt ne ressemble pas à la référence, même avec les bonnes couleurs.
 *
 * Les arrêts sont donc la référence à laquelle on a tourné la teinte vers celle
 * de la marque (151°, celle de #00E676) en conservant la saturation mesurée, et
 * RÉGLÉ LA VALEUR pour retrouver la LUMINANCE PERÇUE relevée à cette hauteur.
 *
 * ⚠️ C'est le point qui a été faux deux fois, dans deux sens opposés.
 *
 * Le premier essai délavait la teinte vers le blanc puis remontait l'intensité,
 * et comptait donc la clarté deux fois. Le second l'a corrigé en conservant la
 * VALEUR HSV — sauf que la valeur ne dit rien de ce que l'œil reçoit : la
 * référence est rouge-dominante (poids 0,299) et Strive vert-dominante (poids
 * 0,587). À valeur égale, le vert rend près de deux fois plus de lumière. Le
 * haut de l'écran sortait 32 % trop clair, et c'est exactement là que ça se
 * voit, puisque c'est là qu'il y a de la lumière.
 *
 * Conserver la luminance ne peut pas produire cette erreur : elle est l'égalité
 * qu'on résout, teinte et saturation étant fixées. Relevé côté DROIT de l'écran
 * de référence, là où le voile de gauche (plus bas) ne mord pas.
 */
const AuthField = () => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    {/* La lueur. Axe strictement VERTICAL : les lignes d'égale intensité sont
        horizontales, comme dans la référence. L'écart gauche/droite est porté
        par le voile plus bas, et par lui seul — le mélanger ici inclinerait la
        chute, et c'est précisément ce qui faisait lire une lumière de coin à la
        place d'un bandeau. */}
    <SafeGradient
      colors={[
        // teinte 151°, saturation relevée, valeur réglée sur la luminance de la
        // référence à cette hauteur — luminance visée en commentaire.
        '#509171', // 122
        '#4E9674', // 125 — le plateau du haut
        '#3D7A5C', // 100
        '#2C6248', //  79
        '#204835', //  58
        '#192E24', //  39
        '#131F19', //  26
        '#101412', //  18,5
        FIELD_TOP,
        FIELD_TOP,
      ]}
      locations={[0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.36, 0.42, 1]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />

    {/* ── LE BALAYAGE ── la lueur n'est PAS un dégradé lisse.
        Chaque ligne de la référence a été comparée à sa propre moyenne
        glissante : le résidu fait apparaître quatre bandes DROITES, deux
        claires et deux sombres, qui glissent vers la gauche en descendant.

        Elles suivent toutes `x + 2,5·y = constante`, avec une dispersion de
        0,02 à 0,055 sur toute la traversée de l'écran — autrement dit ce sont
        des droites parallèles, pas du bruit de compression. Pente −2,5 en
        coordonnées normalisées, soit environ 50° depuis la verticale.

          bande claire 1 : u = 0,400   amplitude +17 à +24 sur un niveau de ~110
          bande sombre 1 : u = 0,505   amplitude −15 à −22
          bande sombre 2 : u = 0,858   amplitude −4
          bande claire 2 : u = 0,980   amplitude +5 à +7

        L'ordre s'inverse entre les deux paires — clair puis sombre pour la
        première, sombre puis clair pour la seconde. C'est ce qui donne le
        relief : ça se lit comme deux plis de lumière et non comme deux traits.

        L'axe du dégradé est parallèle à ∇u = (1 ; 2,5), ce qui donne
        t = u/2 — d'où les arrêts ci-dessous. Au-delà de t ≈ 0,55 tout est
        transparent : les bandes ne vivent que dans le triangle haut, là où il
        y a de la lumière à moduler. */}
    <SafeGradient
      colors={[
        'rgba(255,255,255,0)',
        'rgba(255,255,255,0)',
        'rgba(255,255,255,0.11)',
        'rgba(7,12,9,0.16)',
        'rgba(7,12,9,0)',
        'rgba(7,12,9,0)',
        'rgba(7,12,9,0.06)',
        'rgba(255,255,255,0.08)',
        'rgba(255,255,255,0)',
        'rgba(255,255,255,0)',
      ]}
      locations={[0, 0.14, 0.2, 0.253, 0.32, 0.38, 0.429, 0.49, 0.56, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.276, y: 0.69 }}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />

    {/* La modulation horizontale — TOUTE la largeur, pas un coin.
        Le réglage précédent éteignait la moitié gauche et laissait la moitié
        droite intacte : au milieu de l'écran il rendait 0,96 là où la référence
        est à 0,59, et la lueur basculait en diagonale. Les trois arrêts
        ci-dessous suivent le relevé du point 2 — plateau jusqu'à 0,45, puis
        remontée jusqu'au bord droit :

          x        0,05  0,25  0,45  0,65  0,85  0,95
          référence 0,58  0,69  0,59  0,72  0,96  1,00
          rendu     0,64  0,66  0,68  0,79  0,91  0,97

        Il ne se voit que là où il y a de la lumière à retirer, donc en haut :
        plus bas il assombrit du noir avec du noir. */}
    <SafeGradient
      colors={['rgba(7,12,9,0.40)', 'rgba(7,12,9,0.36)', 'rgba(7,12,9,0)']}
      locations={[0, 0.45, 1]}
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  </View>
);

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
    if (m.includes('rate limit'))
      return t(
        'auth.errors.rateLimit',
        'Trop de tentatives. Réessayez dans quelques minutes.',
      );
    if (m.includes('device_signup_limit_reached'))
      return t(
        'auth.errors.deviceSignupLimit',
        'Trop de comptes créés avec ce téléphone. Veuillez réessayer ultérieurement.',
      );
    // Double compte via un autre provider : le trigger handle_new_user viole
    // idx_profiles_email_normalized_unique (Google john.doe@gmail.com et Apple
    // johndoe@gmail.com donnent le même email normalisé), donc Supabase renvoie
    // une erreur DB opaque du genre « Database error saving new user ». On
    // oriente vers la méthode de connexion d'origine au lieu d'afficher ça.
    if (
      m.includes('email_normalized') ||
      m.includes('duplicate key') ||
      m.includes('database error saving new user')
    ) {
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

  const checkNewUserQuota = async (
    createdAt: string,
    email?: string | null,
  ) => {
    const isNewUser = Date.now() - new Date(createdAt).getTime() < 60_000;
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
        if (data.user)
          await checkNewUserQuota(data.user.created_at, data.user.email);
      }
    } catch (error: any) {
      showToast({
        type: 'error',
        title: t('auth.errors.googleTitle'),
        message: mapAuthError(error.message),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    if (!appleAuth) return;
    setLoading(true);
    try {
      // Le nonce passé ici est le BRUT, pas son empreinte.
      //
      // `@invertase/react-native-apple-authentication` hache lui-même avant
      // d'appeler Apple (RNAppleAuthModule.m : `appleIdRequest.nonce =
      // stringBySha256HashingString(rawNonce)`). Lui donner `sha256(raw)`
      // faisait donc voyager `sha256(sha256(raw))` dans le jeton d'identité,
      // pendant que Supabase comparait avec `sha256(raw)` — d'où le
      // « nonces mismatch », à chaque tentative, sans exception.
      //
      // Le nonce renvoyé par la réponse est celui que le natif a réellement
      // utilisé (raw) : c'est lui qu'on donne à Supabase, plutôt que notre
      // copie locale. Les deux sont égaux aujourd'hui, mais si la lib se met un
      // jour à en générer un elle-même, le lien tient toujours.
      const rawNonce = generateSecureNonce();
      const appleAuthRequestResponse = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
        nonce: rawNonce,
      });
      const { identityToken, fullName, nonce } = appleAuthRequestResponse;
      if (identityToken) {
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: identityToken,
          nonce: nonce ?? rawNonce,
        });
        if (error) throw error;
        if (data.user) {
          const isNewUser =
            Date.now() - new Date(data.user.created_at).getTime() < 60_000;
          if (isNewUser) {
            await checkNewUserQuota(data.user.created_at, data.user.email);
            const displayName = [fullName?.givenName, fullName?.familyName]
              .filter(Boolean)
              .join(' ');
            if (displayName) {
              await supabase.auth.updateUser({
                data: { full_name: displayName },
              });
            }
          }
        }
      }
    } catch (error: any) {
      if (error?.code === appleAuth.Error.CANCELED) return;
      showToast({
        type: 'error',
        title: t('auth.errors.appleTitle'),
        message: mapAuthError(error.message),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    // Le champ est posé HORS du `SafeAreaView`, dans une racine qui va bord à
    // bord. Dedans, il se serait arrêté sous l'encoche : la lueur y est à son
    // maximum, et une bande noire de 50 pt l'aurait coupée net en haut — le
    // contraire d'une source. Sa couleur de bas est celle de la racine, donc
    // rien ne se voit là où il s'arrête.
    <View style={styles.root}>
      <AuthField />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Transparente et non `colors.background` : sur Android une barre opaque
          repeindrait en noir les 24 pt les plus lumineux de la lueur. */}
        <StatusBar
          barStyle="light-content"
          backgroundColor="transparent"
          translucent
        />
        <Toast data={toast} onDismiss={dismissToast} bottomOffset={40} />

        {/* Identité en haut, actions en bas : le pouce ne remonte pas chercher un
          bouton de connexion, et le vide entre les deux laisse la marque
          respirer au premier lancement. */}
        <View style={styles.hero}>
          <Image
            source={require('../assets/strive-logo.png')}
            style={styles.logoImg}
          />
          <View style={styles.wordmarkWrap}>
            <Text style={styles.wordmark}>Strive</Text>
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
                <Text style={styles.btnGoogleText}>
                  {t('auth.continueGoogle')}
                </Text>
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
                  <Text style={styles.btnAppleText}>
                    {t('auth.continueApple')}
                  </Text>
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
            </Text>{' '}
            {t('auth.andText')}{' '}
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
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: FIELD_TOP },
  container: {
    flex: 1,
    paddingHorizontal: space.xl,
  },

  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
  logoImg: { width: 88, height: 88, borderRadius: radius.lg },
  wordmarkWrap: { alignItems: 'center' },
  wordmark: {
    fontSize: 48,
    fontWeight: '900',
    color: colors.textMain,
    letterSpacing: -1.5,
  },
  actions: { paddingBottom: space.xxl, gap: space.md },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: space.xl,
    gap: space.md,
  },
  loadingText: { color: colors.textMuted, fontSize: 14 },

  // Deux pilules de gabarit identique : hauteur 58 (au-dessus des 44 pt de cible
  // tactile minimale, confortable pour un pouce) et rayon plein.
  btnGoogle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 58,
    borderRadius: radius.lg,
    // Blanc cerné d'un filet gris — l'autre variante claire autorisée par les
    // règles d'identité de Google. Le logo a été détouré pour l'occasion : sa
    // plaque #F2F2F2 se serait vue comme un carré gris sur du blanc.
    backgroundColor: '#FFFFFF',
    borderWidth: strokeWidth.control,
    borderColor: '#DADCE0',
  },
  // Texte gris très sombre, également prescrit par Google — pas du noir pur.
  btnGoogleText: { color: '#1F1F1F', fontSize: 16, fontWeight: '700' },
  btnApple: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 58,
    borderRadius: radius.lg,
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
    marginTop: space.lg,
  },
  footerLink: { color: colors.primary, fontWeight: '600' },
});

export default AuthScreen;
