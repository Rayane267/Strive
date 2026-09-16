import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useReduceMotion } from '../hooks/useReduceMotion';

/**
 * Entrée d'une ligne de liste : montée de 8 px et fondu, décalés par rang.
 *
 * Le décalage sert à faire lire l'arrivée COMME une liste — une suite d'éléments
 * liés — plutôt qu'un écran qui clignote d'un coup. Volontairement discret :
 * 180 ms par ligne, 8 px de course, et le retard plafonné à `MAX_STAGGERED`
 * lignes. Au-delà, l'attente cumulée se ferait sentir comme de la latence.
 *
 * Seules les lignes du premier écran s'animent. Les suivantes, montées pendant
 * le défilement, apparaissent immédiatement : une ligne qui se met à monter
 * sous le pouce donne l'impression d'un chargement en retard, pas d'une entrée.
 */

const DURATION = 180;
const STEP_MS = 45;
const RISE = 8;
/** Doit rester ≤ `initialNumToRender` des FlatList appelantes. */
const MAX_STAGGERED = 8;

const ListItemEntrance = ({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) => {
  const animate = index < MAX_STAGGERED;
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!animate) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      delay: index * STEP_MS,
      useNativeDriver: true,
    }).start();
  }, [animate, index, progress]);

  // `Reduce Motion` : le fondu reste (il n'implique aucun déplacement), la
  // montée disparaît. Conforme à la recommandation HIG — remplacer le
  // mouvement, pas supprimer la transition.
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: reduceMotion
          ? []
          : [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [RISE, 0],
                }),
              },
            ],
      }}
    >
      {children}
    </Animated.View>
  );
};

export default React.memo(ListItemEntrance);
