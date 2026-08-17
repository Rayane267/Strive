import React from 'react';
import { StyleSheet } from 'react-native';
import SafeGradient from './SafeGradient';
import { colors } from '../theme/colors';

/**
 * Fond d'écran teinté, posé derrière le contenu.
 *
 * Un fond blanc pur est neutre : il ne dit rien de la marque. Une teinte très
 * légère en haut, qui s'efface vers le bas, donne à l'écran une couleur sans
 * jamais concurrencer le contenu — c'est ce qui fait qu'on reconnaît une app à
 * son fond avant même d'en lire un mot.
 *
 * La teinte est concentrée dans le premier tiers : plus bas, elle passerait
 * derrière les cartes grises et brouillerait la séparation des plans.
 */
const TOP = '#E6F7EE';

const ScreenGradient = () => (
  <SafeGradient
    colors={[TOP, colors.background]}
    start={{ x: 0.5, y: 0 }}
    end={{ x: 0.5, y: 1 }}
    locations={[0, 0.38]}
    style={StyleSheet.absoluteFill}
    pointerEvents="none"
  />
);

export default ScreenGradient;
