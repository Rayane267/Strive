import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import BrandLoader from './BrandLoader';

/**
 * Splash de chargement affiché pendant la restauration de session.
 *
 * Il doit être l'IMAGE FINALE de `StriveSplashView` (iOS). Le splash natif
 * s'efface quand la navigation est montée ; cet écran-ci prend le relais tant
 * que la session se restaure. Toute différence de composition se lirait comme
 * un saut à l'instant précis de la bascule — c'est le seul endroit de l'app où
 * deux technologies dessinent la même image à une frame d'intervalle.
 *
 * Mêmes valeurs des deux côtés, et elles doivent le rester : logo 120, écart 28,
 * wordmark 56 en noir, l'ensemble remonté de 9,6 pt. Ici le logo est une image :
 * son tracé a déjà eu lieu, côté natif.
 *
 * Seul le loader apparaît en fondu — il n'existe pas dans la vue native, et sa
 * place en bas d'écran le rend inoffensif pour la continuité.
 *
 * L'écran joue toujours sa séquence en entier : même session restaurée
 * instantanément, on attend la fin de l'intro (puis du fade-out) avant de
 * rendre la main. Si le boot traîne, le splash reste affiché.
 */
const INTRO_DELAY = 400;
const INTRO_DURATION = 500;
const HOLD_DURATION = 700;
const OUTRO_DURATION = 320;

interface SplashScreenProps {
  /** Passe à true quand l'app est prête à s'afficher (session/profil résolus). */
  ready?: boolean;
  /** Appelé une fois l'intro ET le fade-out terminés. */
  onFinish?: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ ready = false, onFinish }) => {
  const loaderFade = useRef(new Animated.Value(0)).current;
  const screenFade = useRef(new Animated.Value(1)).current;
  const [introDone, setIntroDone] = useState(false);

  // Refs : les props peuvent changer en cours d'anim sans relancer la séquence.
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const finishedRef = useRef(false);

  useEffect(() => {
    const intro = Animated.sequence([
      Animated.timing(loaderFade, {
        toValue: 1,
        duration: INTRO_DURATION,
        delay: INTRO_DELAY,
        useNativeDriver: true,
      }),
      Animated.delay(HOLD_DURATION),
    ]);
    intro.start(({ finished }) => {
      if (finished) setIntroDone(true);
    });

    // FILET DE SÉCURITÉ, et il n'est pas décoratif.
    //
    // `finished` vaut `false` dès que l'animation est interrompue — et si
    // personne ne repasse `introDone` à vrai, `onFinish` n'est jamais appelé :
    // `RootNavigator` garde le splash affiché, pour toujours. Le seul recours
    // serait de tuer l'app. Un état où l'on ne sort plus ne se rattrape pas au
    // cas par cas, il se rend impossible : passé la durée totale de la séquence,
    // on rend la main quoi qu'il soit arrivé à l'animation.
    const failsafe = setTimeout(
      () => setIntroDone(true),
      INTRO_DELAY + INTRO_DURATION + HOLD_DURATION + 1500,
    );

    return () => {
      intro.stop();
      clearTimeout(failsafe);
    };
  }, [loaderFade]);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    Animated.timing(screenFade, {
      toValue: 0,
      duration: OUTRO_DURATION,
      useNativeDriver: true,
    }).start(() => onFinishRef.current?.());
  }, [screenFade]);

  // Fade-out seulement quand l'intro est finie ET que l'app est prête.
  useEffect(() => {
    if (introDone && ready) finish();
  }, [introDone, ready, finish]);

  return (
    <Animated.View style={[styles.container, { opacity: screenFade }]}>
      <View style={styles.brandWrap}>
        <Image
          source={require('../assets/strive-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.wordmark}>Strive</Text>
      </View>

      <Animated.View style={[styles.loaderWrap, { opacity: loaderFade }]}>
        <BrandLoader size={9} />
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandWrap: {
    alignItems: 'center',
    gap: 28,
    // Le même décalage que la vue native : la pile est posée un cheveu au-dessus
    // du centre géométrique, là où l'œil attend un centre optique.
    transform: [{ translateY: -9.6 }],
  },
  logo: { width: 120, height: 120 },
  wordmark: {
    color: colors.textMain,
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -2,
  },
  loaderWrap: {
    position: 'absolute',
    bottom: 80,
  },
});

export default SplashScreen;
