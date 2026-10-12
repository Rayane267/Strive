import React from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import SafeGradient from './SafeGradient';
import { colors } from '../theme/colors';
import { elevation } from '../theme/elevation';

/**
 * Le matériau de la barre d'onglets, posé en fond d'un panneau : flou, voile
 * vert sombre, liseré doux et reflet en dégradé sur le bord haut.
 *
 * Premier enfant du panneau, qui n'a plus de `backgroundColor` à lui. Les
 * coins sont passés ici et non pris au parent : le flou doit être découpé
 * (`overflow: hidden`), alors que le panneau garde son ombre, que la découpe
 * effacerait.
 *
 * Android n'a pas de flou natif digne de ce nom : il garde la surface opaque.
 */
const GlassFill = ({ corners }: { corners: ViewStyle }) => {
  if (Platform.OS !== 'ios') {
    return <View style={[StyleSheet.absoluteFill, corners, styles.android]} pointerEvents="none" />;
  }
  return (
    <View style={[StyleSheet.absoluteFill, corners, styles.clip]} pointerEvents="none">
      <BlurView
        style={StyleSheet.absoluteFill}
        blurType="chromeMaterialDark"
        blurAmount={32}
        reducedTransparencyFallbackColor={colors.surfaceLight}
      />
      <View style={[StyleSheet.absoluteFill, styles.tint]} />
      {/* Reflet en dégradé : il s'éteint avant l'arrondi, cf. TabNavigator. */}
      <SafeGradient
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.3)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.shimmer}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  tint: { backgroundColor: 'rgba(8, 22, 14, 0.42)' },
  shimmer: { position: 'absolute', top: 0, left: '12%', right: '12%', height: 1 },
  android: { backgroundColor: elevation.floating.surface },
});

export default GlassFill;
