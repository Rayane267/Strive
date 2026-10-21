import React from 'react';
import { requireNativeComponent, StyleSheet, View, ViewProps } from 'react-native';

/**
 * Le champ lumineux, version Android — chargée à la place de `ScreenField.tsx`
 * sur Android seulement (suffixe de plateforme), iOS ne la voit jamais.
 *
 * Même champ que sur iOS : nappe `FIELD_TOP` → `FIELD_BOTTOM` et traînée du coin
 * haut droit, fixe à l'écran. Mais dessiné par Android lui-même
 * (`StriveFieldView.kt`) : deux `LinearGradient` y sortaient en bandes ou en
 * quadrillage, la vue native calcule chaque pixel à la taille exacte de l'écran
 * et n'arrondit qu'une fois.
 */
const StriveField = requireNativeComponent<ViewProps>('StriveField');

const ScreenField = () => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <StriveField style={StyleSheet.absoluteFill} />
  </View>
);

export default ScreenField;
