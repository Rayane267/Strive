/**
 * Wrapper d'animation d'entrée pour les composants.
 * Slide + fade in avec un délai optionnel.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';

interface Props {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  slideFrom?: 'bottom' | 'left' | 'right';
  slideDistance?: number;
  style?: ViewStyle;
}

const AnimatedEntrance: React.FC<Props> = ({
  children,
  delay = 0,
  duration = 350,
  slideFrom = 'bottom',
  slideDistance = 20,
  style,
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(slideDistance)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        useNativeDriver: true,
      }),
      Animated.spring(translate, {
        toValue: 0,
        delay,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }),
    ]).start();
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
};

export default AnimatedEntrance;
