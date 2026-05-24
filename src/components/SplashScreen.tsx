import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import BrandLoader from './BrandLoader';

/**
 * Splash de chargement affiché pendant la restauration de session.
 * Le wordmark + accent bar reprennent strictement la composition du
 * LaunchScreen.storyboard natif (mêmes couleurs, taille, position) pour que
 * la transition bootsplash → JS soit invisible. Seul le loader fade-in,
 * puisqu'il n'existe pas côté natif.
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
        <Text style={styles.wordmark}>Strive</Text>
        <View style={styles.accentBar} />
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
