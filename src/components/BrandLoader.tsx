import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import { colors } from '../theme/colors';

interface BrandLoaderProps {
  /** Diamètre des dots (défaut 10) */
  size?: number;
  /** Couleur des dots (défaut colors.primary) */
  color?: string;
  /** Style du container */
  style?: StyleProp<ViewStyle>;
}

/**
 * Loader 3 dots pulsants — pattern Linear / Stripe.
 * Anim opacity + scale en cascade, useNativeDriver pour rester fluide.
 */
const BrandLoader: React.FC<BrandLoaderProps> = ({
  size = 10,
  color = colors.primary,
  style,
}) => {
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;
  const a3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeLoop = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 450,
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0,
            duration: 450,
            useNativeDriver: true,
          }),
        ]),
      );

    const l1 = makeLoop(a1, 0);
    const l2 = makeLoop(a2, 180);
    const l3 = makeLoop(a3, 360);
    l1.start();
    l2.start();
    l3.start();
    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
    };
  }, [a1, a2, a3]);

  const dotStyle = (val: Animated.Value) => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
    opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
    transform: [
      {
        scale: val.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.15] }),
      },
    ],
  });

  return (
    <View style={[styles.container, { gap: size * 0.8 }, style]}>
      <Animated.View style={dotStyle(a1)} />
      <Animated.View style={dotStyle(a2)} />
      <Animated.View style={dotStyle(a3)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default BrandLoader;
