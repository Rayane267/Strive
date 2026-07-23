import React from 'react';
import { View, StyleSheet, ViewStyle, DimensionValue } from 'react-native';

/**
 * Bloc de chargement gris (placeholder statique).
 * Remplace les spinners plein écran : en reproduisant la forme du contenu à
 * venir, le chargement est perçu plus rapide et sans « saut » visuel.
 */
interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

export const Skeleton = ({ width = '100%', height = 16, radius = 8, style }: SkeletonProps) => (
  <View
    style={[styles.block, { width, height, borderRadius: radius }, style]}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
  />
);

const styles = StyleSheet.create({
  block: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
});
