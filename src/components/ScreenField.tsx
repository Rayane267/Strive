import React from 'react';
import { StyleSheet, View } from 'react-native';
import SafeGradient from './SafeGradient';
import { FIELD_TOP, FIELD_BOTTOM } from '../theme/field';

/**
 * Le champ lumineux de l'écran, posé derrière tout le reste.
 *
 * Deux couches, et la seconde n'est pas un ornement.
 *
 * **La nappe** porte la course verticale, du presque noir en haut au vert sombre
 * en bas, répartie linéairement sans point d'arrêt. Un palier à mi-hauteur a été
 * essayé pour répondre à un « trop de vert sur trop de longueur » : il ne créait
 * pas de couture, mais il comprimait la course dans le dernier quart et le vert
 * y devenait un lavis fade. Le bon réglage était l'intensité du bout, pas la
 * longueur du dégradé.
 *
 * **La traînée** donne une DIRECTION au champ. Sans elle, une nappe verticale
 * lisse n'a rien à faire voir : le fond devient un aplat et les conteneurs
 * posés dessus n'ont plus de lieu, juste une couleur. C'est exactement ce que
 * fait la lumière oblique des fonds Revolut.
 *
 * Ce n'est donc pas un halo décoratif — la distinction est celle de
 * `docs/DESIGN-LANGUAGE.md`. Une orbe posée derrière du contenu ne dit rien ; ici
 * la traînée EST la source de lumière de la scène, celle dont `elevation.ts`
 * décrit les conséquences.
 *
 * Fixe à l'écran et non solidaire du contenu : le champ appartient à l'appareil,
 * pas au document.
 */
const ScreenField = () => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <SafeGradient
      colors={[FIELD_TOP, FIELD_BOTTOM]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />

    {/* Entre par le coin haut droit et meurt avant le bas gauche. Les trois
        bornes s'éteignent vite : au-delà, la traînée cesse d'être une lumière
        rasante et devient un fond vert clair. */}
    <SafeGradient
      colors={['rgba(0,230,118,0.10)', 'rgba(0,230,118,0.025)', 'rgba(0,230,118,0)']}
      locations={[0, 0.4, 1]}
      start={{ x: 0.92, y: 0 }}
      end={{ x: 0.08, y: 0.78 }}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  </View>
);

export default ScreenField;
