// Point d'entrée de « Afflux et événements », sous la date d'Historique.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { useReduceMotion } from '../hooks/useReduceMotion';
import StriveAffluxIcon from './StriveAffluxIcon';
import { hapticLight } from '../utils/haptics';
import { City, loadCity } from '../services/cityPulseService';

const LABEL: Record<City, string> = { paris: 'Paris', lyon: 'Lyon', marseille: 'Marseille', nice: 'Nice' };

export default function CityPulseCard() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const reduce = useReduceMotion();
  const [city, setCity] = useState<City>('paris');
  const sheen = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);

  // Relue à chaque retour sur Historique : la ville a pu changer dans l'écran.
  useFocusEffect(useCallback(() => {
    let alive = true;
    loadCity().then(c => { if (alive) setCity(c); });
    return () => { alive = false; };
  }, []));

  // Un reflet traverse la carte de temps en temps, pour qu'on la remarque sans qu'elle crie.
  useEffect(() => {
    if (reduce || !w) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(1200),
      Animated.timing(sheen, { toValue: 1, duration: 1400, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(sheen, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, w, sheen]);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => { hapticLight(); navigation.navigate('CityPulse'); }}
      onLayout={e => setW(e.nativeEvent.layout.width)}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={t('cityPulse.title', 'Afflux et événements')}
    >
      {w > 0 && !reduce && (
        <Animated.View pointerEvents="none" style={[styles.sheen, {
          transform: [{ translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-w * 0.4, w * 1.1] }) }, { skewX: '-20deg' }],
        }]} />
      )}
      <View style={styles.top}>
        <StriveAffluxIcon size={44} />
        <View style={styles.flex1}>
          <Text style={styles.title}>{t('cityPulse.title', 'Afflux et événements')}</Text>
          <Text style={styles.sub}>{LABEL[city]}</Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.textDimmed} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    // Pas de marge latérale : la liste d'Historique porte déjà la gouttière.
    marginBottom: space.md, padding: space.lg, gap: space.md,
    borderRadius: radius.lg, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: strokeWidth.surface, borderColor: stroke.edgeLit,
  },
  flex1: { flex: 1 },
  sheen: { position: 'absolute', top: 0, bottom: 0, width: 70, backgroundColor: 'rgba(255,255,255,0.06)' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { color: colors.textMain, fontSize: 16, fontWeight: '700' },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
});
