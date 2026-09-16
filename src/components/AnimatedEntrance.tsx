/**
 * Wrapper d'animation d'entrée pour les composants.
 * Slide + fade in avec un délai optionnel.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { TRAVEL, TRAVEL_FOCAL, entranceDelay } from '../theme/motion';

interface Props {
  children: React.ReactNode;
  /**
   * Rang de l'élément dans la hiérarchie du contenu, pas son ordre dans le
   * fichier. C'est lui qui décide du retard.
   */
  step?: number;
  /**
   * L'élément que l'écran raconte. Il part de plus loin et arrive après les
   * autres — voir la décomposition du podium dans `src/theme/motion.ts`.
   */
  focal?: boolean;
  /** Retard explicite en ms. Prend le pas sur `step`. */
  delay?: number;
  duration?: number;
  slideFrom?: 'bottom' | 'left' | 'right';
  slideDistance?: number;
  style?: ViewStyle;
}

const AnimatedEntrance: React.FC<Props> = React.memo(({
  children,
  step,
  focal = false,
  delay,
  duration = 350,
  slideFrom = 'bottom',
  slideDistance,
  style,
}) => {
  const reduceMotion = useReduceMotion();

  const resolvedDelay = delay ?? entranceDelay(step ?? 0, focal);
  const distance = slideDistance ?? (focal ? TRAVEL_FOCAL : TRAVEL);

  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(reduceMotion ? 0 : distance)).current;

  useEffect(() => {
    // Mouvement réduit : le contenu apparaît quand même, il ne se déplace plus.
    // Retirer l'entrée entière ferait surgir l'écran d'un coup, ce qui est plus
    // brutal que ce qu'on cherchait à éviter.
    if (reduceMotion) {
      Animated.timing(opacity, {
        toValue: 1, duration: 160, delay: resolvedDelay, useNativeDriver: true,
      }).start();
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay: resolvedDelay,
        useNativeDriver: true,
      }),
      Animated.spring(translate, {
        toValue: 0,
        delay: resolvedDelay,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }),
    ]).start();
    // Animation d'entrée jouée une seule fois au mount — props ignorés volontairement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transform =
    slideFrom === 'bottom'
      ? [{ translateY: translate }]
      : slideFrom === 'left'
        ? [{ translateX: Animated.multiply(translate, -1) }]
        : [{ translateX: translate }];

  return (
    <Animated.View style={[{ opacity, transform }, style]}>
      {children}
    </Animated.View>
  );
});

export default AnimatedEntrance;
