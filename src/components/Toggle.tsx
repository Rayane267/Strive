import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { hapticLight } from '../utils/haptics';
import { useReduceMotion } from '../hooks/useReduceMotion';

/**
 * Interrupteur en pilule, identique sur iOS et Android.
 *
 * Le `Switch` de React Native délègue au composant natif : sur Android il prend
 * la forme Material — piste fine, pouce débordant — qui ne ressemble pas du tout
 * à la pilule iOS. Les deux plateformes affichaient donc deux objets différents
 * pour le même réglage.
 *
 * Les dimensions reprennent celles du commutateur iOS (51 × 31, pouce de 27) :
 * ce sont elles qui donnent la proportion reconnaissable.
 */

const W = 51;
const H = 31;
const PAD = 2;
const THUMB = H - PAD * 2;
const TRAVEL = W - THUMB - PAD * 2;

const Toggle = ({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) => {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) { anim.setValue(value ? 1 : 0); return; }
    Animated.spring(anim, {
      toValue: value ? 1 : 0,
      useNativeDriver: false,
      damping: 18,
      stiffness: 260,
      mass: 0.6,
    }).start();
  }, [value, anim, reduceMotion]);

  // La couleur de piste ne peut pas passer par le pilote natif : on garde donc
  // toute l'animation en JS plutôt que d'en scinder une moitié.
  const trackColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0.14)', colors.primary],
  });
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] });

  return (
    <Pressable
      onPress={() => { if (disabled) return; hapticLight(); onValueChange(!value); }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      // La zone tactile déborde de la pilule : 31 px de haut est sous les 44 pt
      // recommandés, et ce réglage se tape souvent d'une main au volant à l'arrêt.
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }, disabled && styles.disabled]}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  track: {
    width: W,
    height: H,
    borderRadius: H / 2,
    padding: PAD,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  disabled: { opacity: 0.4 },
});

export default Toggle;
