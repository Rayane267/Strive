import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import BrandLoader from './BrandLoader';

/**
 * Splash de chargement affiché pendant la restauration de session.
 * Style "premium fintech" — wordmark centré + tagline + loader discret.
 * Inspiré de l'esthétique Uber / Bolt / Linear.
 */
const SplashScreen: React.FC = () => {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;
  const loaderFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    // Loader entre après le wordmark pour laisser l'œil se poser
    Animated.timing(loaderFade, {
      toValue: 1,
      duration: 500,
      delay: 400,
      useNativeDriver: true,
    }).start();
  }, [fade, slide, loaderFade]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.brandWrap,
          { opacity: fade, transform: [{ translateY: slide }] },
        ]}
      >
        <Text style={styles.wordmark}>Strive</Text>
        <View style={styles.accentBar} />
      </Animated.View>

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
  },
  wordmark: {
    color: colors.textMain,
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -2,
    marginBottom: 14,
  },
  accentBar: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  loaderWrap: {
    position: 'absolute',
    bottom: 80,
  },
});

export default SplashScreen;
