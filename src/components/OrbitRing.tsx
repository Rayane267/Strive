import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import SafeGradient from './SafeGradient';
import { colors } from '../theme/colors';
import { useReduceMotion } from '../hooks/useReduceMotion';

/**
 * Anneau lumineux qui tourne autour de son contenu.
 *
 * Le principe : un dégradé transparent → vert → transparent, posé sur un carré
 * plus grand que le contenu, tourne sans fin. Le conteneur est arrondi et coupe
 * ce qui déborde, si bien qu'on ne voit du dégradé que la portion qui longe le
 * bord — soit une lueur qui fait le tour. Le contenu est ensuite posé par-dessus
 * sur un fond opaque, et ne laisse dépasser que l'épaisseur de l'anneau.
 *
 * Le carré tournant doit dépasser la diagonale du contenu, sinon ses coins
 * découvriraient le bord en passant. `SIZE` est volontairement large : il est
 * rogné de toute façon, et une valeur trop juste se voit immédiatement.
 *
 * `useNativeDriver` : une rotation continue repassant par le thread JS
 * saccaderait au premier ralentissement, et celle-ci ne s'arrête jamais.
 */

const SIZE = 320;
const DURATION = 3200;

const OrbitRing = ({
  thickness = 2,
  style,
  children,
}: {
  /** Épaisseur visible de l'anneau, en points. */
  thickness?: number;
  style?: ViewStyle;
  children: React.ReactNode;
}) => {
  const spin = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: DURATION,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, reduceMotion]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[styles.wrap, { padding: thickness }, style]}>
      {/* Reduce Motion : l'anneau reste, immobile. Le supprimer ferait
          disparaître un élément de l'interface au lieu d'en retirer le
          mouvement — ce que la recommandation d'accessibilité demande. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.spinner,
          reduceMotion ? null : { transform: [{ rotate }] },
        ]}
      >
        {/* Bande étroite plutôt que dégradé étalé : c'est ce qui fait lire un
            segment qui court le long du bord, et non une lueur diffuse sur toute
            la pilule. Elle part du haut — le point vif est calé au-dessus du
            centre — et fait le tour.

            Une seule couleur, le vert de « En ligne » : l'anneau appartient à la
            même famille que l'état actif de l'app. */}
        {/* Le point vif est calé sur le BORD HAUT du contenu, pas sur son centre.
            Une bande passant par le centre traverserait la pilule de part en
            part et allumerait ses deux bords à la fois : on verrait deux
            segments opposés au lieu d'un. Décalée sur le bord, elle n'en éclaire
            qu'un — celui du haut au départ, puis tout le tour. */}
        <SafeGradient
          colors={['transparent', 'transparent', colors.primary, 'transparent', 'transparent']}
          locations={[0, 0.40, 0.432, 0.465, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 999,
    overflow: 'hidden',
    // Sur fond sombre, le liseré au repos est un blanc très discret : l'anneau
    // doit rester visible même quand le segment vert n'est pas passé dessus.
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  spinner: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    left: '50%',
    top: '50%',
    marginLeft: -SIZE / 2,
    marginTop: -SIZE / 2,
  },
});

export default OrbitRing;
