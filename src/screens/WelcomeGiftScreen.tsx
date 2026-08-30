/**
 * Annonce des scans de bienvenue — l'écran qui dit au chauffeur ce qu'il vient
 * de recevoir, juste après l'onboarding et juste avant le paywall.
 *
 * POURQUOI IL EXISTE. Les 30 scans sont crédités par `grant_welcome_credits`
 * sans que rien ne le dise : le chauffeur verrait un « +30 » apparaître à côté
 * de son compteur sans savoir ni ce que c'est, ni qu'il a 14 jours pour s'en
 * servir. Or toute la mécanique de conversion repose là-dessus — c'est la PERTE
 * ressentie à l'épuisement qui vend l'abonnement, et on ne perd que ce qu'on
 * savait posséder. Sans cet écran, le cadeau est un cadeau que personne ne
 * reçoit.
 *
 * FOND OPAQUE, et pas un voile. L'idée d'origine — laisser le Dashboard
 * devinable derrière pour rattacher le cadeau à l'app du chauffeur — s'est
 * révélée fausse à l'écran : ce n'est pas le Dashboard qui est derrière à ce
 * moment du parcours, c'est le TUTORIEL. On lisait « Welcome to Strive »,
 * « Skip », « 1 / 6 » au travers du voile, en concurrence directe avec le
 * chiffre annoncé. Deux textes superposés ne font pas de la profondeur, ils
 * font une page cassée.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Easing, Pressable, Image, useWindowDimensions,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../theme/colors';
import { hapticSuccess } from '../utils/haptics';
import useReduceMotion from '../hooks/useReduceMotion';
import { useAuth } from '../context/AuthContext';
import SafeGradient from '../components/SafeGradient';

/** Nombre d'étincelles de la salve. 8 : assez pour lire une explosion, assez peu
 *  pour rester net sur un écran de téléphone — au-delà ça fait confetti. */
const SPARKS = 8;

const WelcomeGiftScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  const { profile } = useAuth();

  /// Le prénom, et c'est le levier le plus fort de l'écran. Un cadeau adressé à
  /// personne n'est pas un cadeau, c'est une notification. On l'a en base depuis
  /// la création du profil, deux écrans plus tôt — ne pas s'en servir ici était
  /// le vrai manque. Repli sur un libellé neutre si le prénom est absent, ce qui
  /// arrive sur un compte importé ou incomplet.
  const firstName = (profile?.first_name ?? '').trim().split(' ')[0];

  const amount: number = route.params?.amount ?? 30;
  const expiresInDays: number = route.params?.expiresInDays ?? 14;
  const thenPaywall: boolean = route.params?.thenPaywall ?? false;

  // ── Valeurs animées ───────────────────────────────────────────────────────
  const scrim  = useRef(new Animated.Value(0)).current;  // voile
  const pop    = useRef(new Animated.Value(0)).current;  // disque + icône
  const halo   = useRef(new Animated.Value(0)).current;  // onde qui s'échappe
  const spark  = useRef(new Animated.Value(0)).current;  // salve d'étincelles
  const title  = useRef(new Animated.Value(0)).current;
  const sub    = useRef(new Animated.Value(0)).current;
  const cta    = useRef(new Animated.Value(0)).current;
  const sheen  = useRef(new Animated.Value(0)).current;  // balayage de lumière

  /// Deux valeurs pour un seul décompte — même raison que `compute`/`computeJs`
  /// dans OnboardingScreen : le pilote natif ne sait pas écrire du texte, et
  /// faire passer le nombre par le pont JS à chaque frame n'a de coût que sur
  /// cette unique valeur. Lancées ensemble, elles ne se désynchronisent pas.
  const countJs = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(reduceMotion ? amount : 0);

  useEffect(() => {
    // Mouvement réduit : on donne l'information, pas le spectacle. Le chiffre
    // est déjà à sa valeur finale (`shown` initialisé plus haut), tout arrive
    // d'un même fondu court.
    if (reduceMotion) {
      Animated.timing(scrim, {
        toValue: 1, duration: 160, useNativeDriver: true,
      }).start();
      Animated.parallel(
        [pop, title, sub, cta].map(v =>
          Animated.timing(v, { toValue: 1, duration: 200, useNativeDriver: true }),
        ),
      ).start();
      return;
    }

    hapticSuccess();

    const id = countJs.addListener(({ value }) => {
      setShown(Math.round(value * amount));
    });

    Animated.sequence([
      Animated.timing(scrim, {
        toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      // Le disque arrive en ressort : c'est le seul geste « joyeux » de l'écran,
      // et il porte tout le reste, qui n'est ensuite que du fondu.
      Animated.parallel([
        Animated.spring(pop, {
          toValue: 1, damping: 9, stiffness: 190, mass: 0.9, useNativeDriver: true,
        }),
        // Onde et étincelles partent AVEC le disque, pas après : une salve qui
        // suit l'impact au lieu de le composer se lit comme un second événement.
        Animated.timing(halo, {
          toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(spark, {
          toValue: 1, duration: 760, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]),
      // Le décompte démarre une fois le disque posé — un chiffre qui défile
      // pendant que son support bouge encore est illisible.
      Animated.timing(countJs, {
        toValue: 1, duration: 850, easing: Easing.out(Easing.cubic), useNativeDriver: false,
      }),
      // Balayage de lumière au sommet exact du moment : le chiffre vient de
      // s'arrêter sur sa valeur. C'est le geste qui signe une révélation dans
      // les apps qui font ça bien (dévoilement de carte Revolut, Apple Card) —
      // une seule passe, jamais en boucle, sinon ça devient un écran de veille.
      Animated.timing(sheen, {
        toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(title, {
        toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(sub, {
        toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      // Le bouton en dernier, et c'est délibéré : tant qu'il n'est pas là, il n'y
      // a rien à toucher, donc rien qui invite à passer l'écran avant de l'avoir lu.
      Animated.timing(cta, {
        toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
    ]).start();

    return () => countJs.removeListener(id);
  }, [reduceMotion, amount, scrim, pop, halo, spark, title, sub, cta, sheen, countJs]);

  const dismiss = () => {
    navigation.goBack();
    // Le paywall enchaîne : le chauffeur vient d'apprendre ce qu'il a, c'est le
    // moment où l'offre payante se lit comme « et après », pas comme une taxe.
    if (thenPaywall) navigation.navigate('SubscriptionScreen');
  };

  // Distance de projection des étincelles — bornée pour ne pas sortir du cadre
  // sur les petits écrans.
  const sparkDist = Math.min(width * 0.34, 140);

  const rise = (v: Animated.Value) => ({
    opacity: v,
    transform: [{
      translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
    }],
  });

  return (
    <Animated.View style={[styles.root, { opacity: scrim }]}>
      {/* DÉGRADÉ PRÉ-TRAMÉ, en image et non en `LinearGradient`.
          Pourquoi : un dégradé calculé sur un fond quasi noir progresse par
          paliers de 1/255 étalés sur 20 à 40 px — mesuré ici, 107 valeurs
          distinctes sur 2200 px, que l'œil lit comme des BARRES horizontales.
          Et c'est contre-intuitif : baisser le contraste ÉLARGIT les barres,
          puisqu'il y a moins de transitions à répartir sur la même hauteur.
          Aucun réglage de couleurs ne s'en sort.
          Le tramage doit donc être cuit dans l'asset. `gift-bg.png` porte un
          bruit signé de ±2 unités qui dissout chaque frontière de palier sans
          être perceptible comme du grain. Généré à 360×800 et affiché en
          `cover` : à l'écran un pixel de bruit devient un bloc de ~3 px, ce qui
          dithère toujours et garde l'asset à 200 Ko (le bruit ruine la
          compression PNG, d'où la petite taille source).
          Le dégradé s'éteint à 60 % de la hauteur et finit exactement sur
          `#0A120E`, le fond de l'app — un arrêt plus sombre que lui creusait un
          trou noir en bas de l'écran. */}
      {/* `width/height: '100%'` EN PLUS de `absoluteFill` : sans dimensions
          explicites, l'image se dessine à sa taille intrinsèque en points
          (360×800 dp) et laissait une COUTURE VERTICALE à droite — sur un écran
          en densité 2,625, 360 dp ne font que 945 px sur 1080. */}
      <Image
        source={require('../assets/gift-bg.png')}
        style={[StyleSheet.absoluteFill, styles.bgImage]}
        resizeMode="cover"
      />

      <View style={styles.card}>
        {/* Le balayage, clippé à la zone du chiffre. `overflow: hidden` sur
            `sheenClip` l'empêche de baver sur le reste de l'écran. */}
        {!reduceMotion && (
          <View style={styles.sheenClip} pointerEvents="none">
            <Animated.View
              style={[styles.sheen, {
                opacity: sheen.interpolate({
                  inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0],
                }),
                transform: [
                  { rotate: '18deg' },
                  {
                    translateX: sheen.interpolate({
                      inputRange: [0, 1], outputRange: [-260, 420],
                    }),
                  },
                ],
              }]}
            >
              <SafeGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
        )}

        {/* ── Disque, onde et étincelles ───────────────────────────────── */}
        <View style={styles.emblem}>
          {!reduceMotion && (
            <>
              {/* Onde : un anneau qui grandit en s'effaçant. Rendu sous le
                  disque pour qu'il ait l'air d'en sortir. */}
              <Animated.View
                pointerEvents="none"
                style={[styles.wave, {
                  opacity: halo.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.5, 0] }),
                  transform: [{
                    scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.1] }),
                  }],
                }]}
              />
              {Array.from({ length: SPARKS }).map((_, i) => {
                const angle = (i / SPARKS) * 2 * Math.PI;
                return (
                  <Animated.View
                    key={i}
                    pointerEvents="none"
                    style={[styles.spark, {
                      opacity: spark.interpolate({
                        inputRange: [0, 0.15, 1], outputRange: [0, 1, 0],
                      }),
                      transform: [
                        {
                          translateX: spark.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, Math.cos(angle) * sparkDist],
                          }),
                        },
                        {
                          translateY: spark.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, Math.sin(angle) * sparkDist],
                          }),
                        },
                        {
                          scale: spark.interpolate({
                            inputRange: [0, 0.4, 1], outputRange: [0.4, 1, 0.2],
                          }),
                        },
                      ],
                    }]}
                  />
                );
              })}
            </>
          )}

          <Animated.View
            style={[styles.disc, {
              opacity: pop,
              transform: [{
                scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
              }],
            }]}
          >
            {/* Le logo Strive plutôt qu'un glyphe de scan : c'est l'app qui
                offre, et le chauffeur vient de la découvrir — l'icône QR ne
                disait rien du geste, elle nommait juste la fonctionnalité. */}
            <Image source={require('../assets/strive-logo.png')} style={styles.logo} />
            {/* Le cadeau en pastille, posé sur le logo comme un badge : c'est
                lui qui porte la nouvelle. Seul, il aurait pu venir de n'importe
                quelle app ; seul, le logo n'aurait rien annoncé. */}
            <View style={styles.giftBadge}>
              <MaterialCommunityIcons name="gift" size={19} color="#04120B" />
            </View>
          </Animated.View>
        </View>

        {/* ── Le chiffre, écrit comme l'app écrit ses chiffres ──────────── */}
        {/* Partout ailleurs, Strive pose un nombre lourd suivi de son unité en
            plus petit : `0€`, `0€/h`, `€57/h`. On reprend exactement cette
            forme au lieu d'un chiffre nu — et `+30` est littéralement ce que le
            chauffeur va lire sur son Dashboard, à côté de `0/3`. L'écran montre
            donc ce qui l'attend, il ne le décrit pas.
            `accessibilityLabel` porte la valeur FINALE : un lecteur d'écran qui
            annoncerait 0, 4, 11, 19… pendant le décompte serait inutilisable. */}
        {/* Le prénom, en phrase humaine et à taille lisible : il ouvre l'écran
            sans lui voler la vedette. En petites capitales vertes il faisait
            étiquette générique — ici il annonce simplement à qui on parle. */}
        <Animated.Text style={[styles.hello, { opacity: pop }]}>
          {firstName
            ? t('welcomeGift.helloNamed', { name: firstName, defaultValue: 'Bienvenue, {{name}}.' })
            : t('welcomeGift.hello', 'Bienvenue.')}
        </Animated.Text>

        {/* ── Le chiffre, et c'est TOUT l'écran ─────────────────────────── */}
        {/* L'audace est dépensée ici, une seule fois : aucun autre écran de
            l'app ne porte un nombre de cette taille. C'est l'échelle qui fait
            l'événement — pas un halo, pas une pastille, pas un confetti. Tout
            le reste autour reste volontairement calme.
            `accessibilityLabel` porte la valeur FINALE : un lecteur d'écran qui
            annoncerait 0, 4, 11, 19… pendant le décompte serait inutilisable. */}
        <Animated.Text
          style={[styles.count, { opacity: pop }]}
          accessibilityLabel={t('welcomeGift.a11y', { n: amount, defaultValue: '{{n}} scans offerts' })}
        >
          +{shown}
        </Animated.Text>

        <Animated.Text style={[styles.unit, rise(title)]}>
          {t('welcomeGift.unit', 'scans offerts')}
        </Animated.Text>

        <Animated.Text style={[styles.sub, rise(sub)]}>
          {t('welcomeGift.body', {
            defaultValue:
              'À utiliser dans les {{days}} jours, en plus de vos scans quotidiens.',
            days: expiresInDays,
          })}
        </Animated.Text>

      </View>

      <Animated.View style={[styles.ctaWrap, rise(cta)]}>
          <Pressable
            onPress={dismiss}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          >
            <SafeGradient
              colors={['#5BFF9F', '#00E676']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ctaInner}
            >
              <Text style={styles.ctaText}>
                {/* « Commencer » décrit une navigation. « J'en profite » décrit
                    ce que le chauffeur fait de son cadeau — c'est lui qui parle,
                    pas l'app qui l'oriente. */}
                {t('welcomeGift.cta', "J'en profite")}
              </Text>
            </SafeGradient>
          </Pressable>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Peint quand même en dur SOUS le dégradé : si le module natif du gradient
    // n'est pas encore monté, l'écran ne doit pas apparaître transparent — le
    // tutoriel vit derrière.
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    // PAS de padding ici : un enfant en position absolue se cale sur la boîte de
    // PADDING et non sur le bord de la vue. L'image de fond était donc rognée,
    // laissant une couture verticale visible. La marge latérale appartient
    // désormais à `card`, qui est le seul à en avoir besoin.
  },
  // CENTRÉ. Cet écran n'est pas un écran comme les autres : c'est un moment,
  // pas une page qu'on parcourt. L'axe central le pose comme tel — et ce qui
  // faisait « généré » n'était pas le centrage, c'était la décoration qui
  // l'entourait (étiquette en capitales, halos, pastille cerclée), maintenant
  // retirée. L'audace tient dans l'échelle du chiffre, rien d'autre.
  bgImage: { width: '100%', height: '100%' },
  // PAS de `flex: 1` ici. Essayé, et à retirer : la carte prenait toute la
  // hauteur au-dessus du bouton, qui se retrouvait collé au bord inférieur avec
  // 500 px de vide entre lui et le texte. Contenu et bouton forment UN bloc,
  // centré ensemble par `root` — c'est ce qui garde le bouton à portée de
  // lecture, ni contre le texte ni au fond de l'écran.
  card: {
    alignItems: 'center',
    width: '100%', maxWidth: 460, alignSelf: 'center',
    paddingHorizontal: 32,
  },
  // Fenêtre du balayage : il ne doit traverser que l'emblème et le chiffre, pas
  // le paragraphe ni le bouton.
  sheenClip: {
    position: 'absolute',
    top: 0, left: -40, right: -40, height: 300,
    overflow: 'hidden',
  },
  sheen: { position: 'absolute', top: -80, width: 120, height: 460 },
  emblem: {
    // Réduit : à 108 px il concurrençait le chiffre. C'est une marque posée en
    // haut, pas le sujet de l'écran.
    width: 84, height: 84,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 18,
  },
  wave: {
    position: 'absolute',
    width: 84, height: 84, borderRadius: 42,
    borderWidth: 2, borderColor: colors.primary,
  },
  spark: {
    position: 'absolute',
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: colors.primary,
  },
  disc: {
    width: 64, height: 64,
    alignItems: 'center', justifyContent: 'center',
    // `overflow: visible` implicite : la pastille cadeau dépasse volontairement
    // du disque, c'est ce qui la fait lire comme posée dessus.
  },
  logo: { width: 62, height: 62, resizeMode: 'contain' },
  giftBadge: {
    position: 'absolute', right: -10, bottom: -8,
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
    // Le liseré reprend le fond de la page : il détache la pastille du disque
    // sans ajouter de couleur.
    borderWidth: 3, borderColor: colors.background,
  },
  hello: {
    color: colors.textMain,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.2,
    textAlign: 'center',
    marginBottom: 4,
  },
  count: {
    color: colors.primary,
    fontSize: 132,
    fontWeight: '900',
    lineHeight: 138,
    // Interlettrage très serré : à cette taille, l'espacement par défaut fait
    // flotter les chiffres au lieu de les souder en un bloc.
    letterSpacing: -7,
    textAlign: 'center',
    // Les chiffres ne doivent pas changer de largeur pendant le décompte, sinon
    // le nombre tressaute à chaque dizaine.
    fontVariant: ['tabular-nums'],
  },
  unit: {
    color: colors.textMain,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: -6,
  },
  sub: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  ctaWrap: {
    width: '100%', maxWidth: 460, alignSelf: 'center',
    paddingHorizontal: 32,
    // 44 et non 30 : le bouton respire davantage qu'à l'origine sans quitter le
    // bloc. Aucun `paddingBottom` — il ne doit pas être ancré au bas de l'écran.
    marginTop: 44,
  },
  cta: {
    // Dégradé et non aplat : l'écran Profil traite déjà son bouton d'upgrade
    // ainsi. Un vert plein à côté d'un fond dégradé paraissait plat.
    borderRadius: 16,
    overflow: 'hidden',
  },
  ctaInner: { paddingVertical: 17, alignItems: 'center' },
  ctaPressed: { opacity: 0.85 },
  ctaText: { color: '#04120B', fontSize: 16, fontWeight: '700' },
});

export default WelcomeGiftScreen;
