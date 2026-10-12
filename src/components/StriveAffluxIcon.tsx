// Icône « Afflux et événements » : les trois barres du logo Strive, passées au
// vert et animées comme une jauge qui monte.
//
// Le logo pose trois barres décalées (claire, grise, claire) sur un carré vert
// sombre. On garde la forme — c'est elle qui fait reconnaître la marque — et on
// en fait un signal : chaque barre s'allonge et se rétracte à son rythme, comme
// une affluence qui gonfle. Mouvement réduit : barres immobiles.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import SafeGradient from './SafeGradient';
import { useReduceMotion } from '../hooks/useReduceMotion';

// Proportions reprises de strive-logo.png : trois barres de même longueur,
// décalées vers la droite, au centre puis vers la gauche.
const BARS = [
  { offset: 0.06, color: '#5CF2A6', period: 1300 },
  { offset: 0, color: 'rgba(92,242,166,0.55)', period: 1700 },
  { offset: -0.06, color: '#E6F2EC', period: 1500 },
];

export default function StriveAffluxIcon({ size = 44 }: { size?: number }) {
  const reduce = useReduceMotion();
  const values = useRef(BARS.map(() => new Animated.Value(1))).current;

  useEffect(() => {
    if (reduce) return;
    const loops = values.map((v, i) =>
      Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 0.55, duration: BARS[i].period, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: BARS[i].period, useNativeDriver: true }),
      ])));
    // Départs décalés : les barres ne battent jamais à l'unisson.
    loops.forEach((l, i) => setTimeout(() => l.start(), i * 260));
    return () => loops.forEach(l => l.stop());
  }, [reduce, values]);

  const barW = size * 0.44;
  const barH = Math.max(3, size * 0.1);

  return (
    <SafeGradient
      colors={['#24402F', '#14251B']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.tile, { width: size, height: size, borderRadius: size * 0.28, gap: barH * 0.7 }]}
    >
      {BARS.map((b, i) => (
        <Animated.View
          key={i}
          style={{
            width: barW,
            height: barH,
            borderRadius: barH / 2,
            backgroundColor: b.color,
            // Le décalage du logo, puis l'allongement depuis le bord gauche.
            transform: [
              { translateX: b.offset * size },
              { translateX: Animated.multiply(Animated.add(values[i], -1), barW / 2) },
              { scaleX: values[i] },
            ],
          }}
        />
      ))}
      <View pointerEvents="none" style={[styles.edge, { borderRadius: size * 0.28 }]} />
    </SafeGradient>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  edge: { ...StyleSheet.absoluteFillObject, borderWidth: 1, borderColor: 'rgba(0,230,118,0.30)' },
});

