// Point d'entrée de « Événements et perturbations », sous la date d'Historique.
//
// Les compteurs disent ce qu'il y a derrière la carte avant qu'on la touche :
// une carte muette se ferait ignorer au bout de trois jours.

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
import { hapticLight } from '../utils/haptics';
import { City, fetchCitySignals, isCurrent, loadCity } from '../services/cityPulseService';

const LABEL: Record<City, string> = { paris: 'Paris', lyon: 'Lyon', marseille: 'Marseille', nice: 'Nice' };

export default function CityPulseCard() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const reduce = useReduceMotion();
  const [city, setCity] = useState<City>('paris');
  const [counts, setCounts] = useState<{ transit: number; trains: number; events: number } | null>(null);
  const sheen = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);

  // Rechargé à chaque retour sur Historique : la ville a pu changer dans l'écran.
  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const c = await loadCity();
      try {
        const rows = (await fetchCitySignals(c)).filter(r => isCurrent(r));
        if (!alive) return;
        setCity(c);
        setCounts({
          transit: rows.filter(r => r.kind === 'transit_disruption').length,
          trains: rows.filter(r => r.kind === 'train_arrivals').length,
          events: rows.filter(r => r.kind === 'event').length,
        });
      } catch {
        if (alive) { setCity(c); setCounts(null); }
      }
    })();
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
      accessibilityLabel={t('cityPulse.title', 'Événements et perturbations')}
    >
      {w > 0 && !reduce && (
        <Animated.View pointerEvents="none" style={[styles.sheen, {
          transform: [{ translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-w * 0.4, w * 1.1] }) }, { skewX: '-20deg' }],
        }]} />
      )}
      <View style={styles.top}>
        <View style={styles.icon}>
          <Feather name="zap" size={20} color="#FF8A8A" />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.title}>{t('cityPulse.title', 'Événements et perturbations')}</Text>
          <Text style={styles.sub}>{LABEL[city]}</Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.textDimmed} />
      </View>
      {counts && (
        <View style={styles.pills}>
          {counts.transit > 0 && (
            <Text style={[styles.pill, styles.pillRed]}>
              {t('cityPulse.countTransit', '{{count}} perturbation', { count: counts.transit })}
            </Text>
          )}
          {counts.trains > 0 && (
            <Text style={[styles.pill, styles.pillGreen]}>
              {t('cityPulse.countTrains', '{{count}} vague de trains', { count: counts.trains })}
            </Text>
          )}
          <Text style={[styles.pill, styles.pillGrey]}>
            {t('cityPulse.countEvents', '{{count}} événement à venir', { count: counts.events })}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    // Pas de marge latérale : la liste d'Historique porte déjà la gouttière.
    marginBottom: space.md, padding: space.lg, gap: space.md,
    borderRadius: radius.lg, overflow: 'hidden', backgroundColor: 'rgba(255,77,77,0.06)',
    borderWidth: strokeWidth.surface, borderColor: stroke.edgeLit,
  },
  flex1: { flex: 1 },
  sheen: { position: 'absolute', top: 0, bottom: 0, width: 70, backgroundColor: 'rgba(255,255,255,0.06)' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,77,77,0.16)',
  },
  title: { color: colors.textMain, fontSize: 16, fontWeight: '700' },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: {
    fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full, overflow: 'hidden',
  },
  pillRed: { backgroundColor: 'rgba(255,77,77,0.14)', color: '#FFB3B3' },
  pillGreen: { backgroundColor: 'rgba(0,230,118,0.10)', color: '#5CF2A6' },
  pillGrey: { backgroundColor: 'rgba(255,255,255,0.07)', color: '#C9D1CD' },
});
