import React, { useEffect, useRef } from 'react';
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
 */
const SplashScreen: React.FC = () => {
  const loaderFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(loaderFade, {
      toValue: 1,
      duration: 500,
      delay: 400,
      useNativeDriver: true,
    }).start();
  }, [loaderFade]);

  return (
    <View style={styles.container}>
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
    </View>
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
