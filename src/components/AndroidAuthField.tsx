import React from 'react';
import { processColor, requireNativeComponent, StyleSheet, View, ViewProps } from 'react-native';
import { FIELD_TOP } from '../theme/field';

/**
 * Le champ de l'écran de connexion, version Android — chargé par `AuthScreen`
 * sur Android seulement (la branche iOS ne l'évalue jamais).
 *
 * Même idée qu'`AuthField` (AuthScreen.tsx) — la lumière vient du HAUT, sur
 * la marque — mais redessinée pour Android à la demande de l'utilisateur
 * (2026-10-21, « ça fait pas propre », variante A choisie sur maquette) :
 * un halo ROND et doux qui descend du haut de l'écran, à la place de la lueur
 * en bande, de ses plis en diagonale et du voile qui éclaircissait le coin
 * haut droit. Ces trois-là se lisaient comme des taches, pas comme une source.
 *
 * Le halo : centré au milieu, juste au-dessus du bord haut ; rayons de 105 %
 * de la largeur et 48 % de la hauteur ; le vert du sommet (#267D53) rejoint
 * FIELD_TOP selon 1 − (1 − d)^1,8, d étant la distance normalisée au centre.
 *
 * Dessiné par `StriveGradientStackView.kt` : calcul en flottant à la taille
 * exacte de l'écran, un seul arrondi avec un grain fin — ni bande, ni motif.
 */

type Layer = {
  type: 'radial';
  colors: string[];
  locations: number[];
  center: { x: number; y: number };
  radius: { x: number; y: number };
};

const LAYERS: Layer[] = [
  {
    type: 'radial',
    colors: [
      '#267D53', '#216946', '#1C583B', '#174730', '#133927', '#102C1E',
      '#0D2217', '#0B1911', '#09120D', '#070E0A', FIELD_TOP,
    ],
    locations: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    center: { x: 0.5, y: -0.02 },
    radius: { x: 1.05, y: 0.48 },
  },
];

const NATIVE_LAYERS = LAYERS.map(l => ({
  ...l,
  colors: l.colors.map(c => processColor(c) as number),
}));

const StriveGradientStack = requireNativeComponent<
  ViewProps & { layers: typeof NATIVE_LAYERS; backdrop: string }
>('StriveGradientStack');

const AndroidAuthField = () => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <StriveGradientStack
      style={StyleSheet.absoluteFill}
      layers={NATIVE_LAYERS}
      backdrop={FIELD_TOP}
    />
  </View>
);

export default AndroidAuthField;
