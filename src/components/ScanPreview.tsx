/**
 * Maquette d'un résultat de scan, telle qu'elle apparaît réellement sur iOS :
 * l'îlot dynamique. Trois courses — une bonne, une moyenne, une mauvaise — que
 * l'on fait défiler en tapant dessus.
 *
 * Partagée entre le tutoriel, où elle montre OÙ le verdict apparaît, et
 * l'onboarding, où elle montre CE QUE fait l'app avant qu'on demande quoi que ce
 * soit au chauffeur. Un composant et pas deux copies : ces chiffres sont la
 * vitrine du produit, ils ne doivent pas diverger d'un écran à l'autre.
 *
 * Les valeurs sont crédibles et non arrondies — 17 € pour 28 min et 5,4 km fait
 * 53 €/h, le calcul tient si quelqu'un le refait. Une démonstration dont les
 * chiffres ne tombent pas juste se retourne contre le produit qu'elle vend.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { hapticLight } from '../utils/haptics';

export const PREVIEW_DATA = [
  { hourly: 53, fare: 17, km: '3.15', duration: 28, distance: '5.4', color: '#00C752', icon: 'check' as const, verdictKey: 'tutorial.iosPreview.verdictTake', hintKey: 'tutorial.iosPreview.hintGood' },
  { hourly: 38, fare: 7,  km: '3.50', duration: 9,  distance: '2.0', color: '#FF9900', icon: 'alert-triangle' as const, verdictKey: 'tutorial.iosPreview.verdictMaybe', hintKey: 'tutorial.iosPreview.hintAverage' },
  { hourly: 15, fare: 22, km: '0.78', duration: 42, distance: '10.3', color: '#F04444', icon: 'x' as const, verdictKey: 'tutorial.iosPreview.verdictSkip', hintKey: 'tutorial.iosPreview.hintBad' },
];

const ScanPreview = ({ style }: { style?: StyleProp<ViewStyle> }) => {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const p = PREVIEW_DATA[idx];

  return (
    <View style={[styles.block, style]}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => { hapticLight(); setIdx((idx + 1) % PREVIEW_DATA.length); }}
        accessibilityRole="button"
        accessibilityLabel={t(p.verdictKey)}
      >
        <View style={styles.dynamicIsland}>
          <View style={styles.diRowTop}>
            <Text style={styles.diPlatform}>Uber</Text>
            <View style={styles.diHourly}>
              <Text style={styles.diHourlyValue}>€{p.hourly}</Text>
              <Text style={styles.diHourlyUnit}>/h</Text>
            </View>
            <View style={{ flex: 1 }} />
            <View style={[styles.diFarePill, { backgroundColor: p.color + '46', borderColor: p.color + 'D9' }]}>
              <Text style={styles.diFarePillTxt}>€{p.fare}</Text>
            </View>
            <View style={styles.diKmRate}>
              <Feather name="arrow-up-right" size={11} color={p.color} />
              <Text style={styles.diKmRateTxt}>€{p.km}/km</Text>
            </View>
          </View>
          <View style={styles.diRouteRow}>
            <View style={[styles.diRouteCircle, { backgroundColor: p.color }]}>
              <MaterialCommunityIcons name="car" size={12} color="#000" />
            </View>
            <View style={styles.diRouteLineWrap}>
              <View style={[styles.diRouteLine, { backgroundColor: p.color + 'D9' }]} />
              <View style={[styles.diRouteDot, { backgroundColor: p.color }]} />
            </View>
            <View style={styles.diRouteStats}>
              <Text style={styles.diRouteDuration}>{p.duration}min</Text>
              <Text style={styles.diRouteDistance}>{p.distance}km</Text>
            </View>
            <View style={[styles.diRouteCircle, { backgroundColor: p.color }]}>
              <Feather name={p.icon} size={12} color="#000" />
            </View>
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.previewVerdict}>
        <View style={[styles.previewVerdictDot, { backgroundColor: p.color }]} />
        <Text style={[styles.previewVerdictTxt, { color: p.color }]}>{t(p.verdictKey)}</Text>
      </View>

      <Text style={styles.previewHintTxt}>{t(p.hintKey)}</Text>

      <View style={styles.previewDots}>
        {PREVIEW_DATA.map((d, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => { hapticLight(); setIdx(i); }}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            accessibilityRole="button"
          >
            <View style={[styles.previewDot, i === idx && { backgroundColor: d.color, width: 24 }]} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  dynamicIsland: {
    width: '100%',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(0,0,0,0.92)',
    gap: 16,
  },
  diRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  diPlatform: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
    fontWeight: '600',
  },
  diHourly: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  diHourlyValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  diHourlyUnit: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: '600',
  },
  diFarePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  diFarePillTxt: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  diKmRate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  diKmRateTxt: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  diRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  diRouteCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diRouteLineWrap: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diRouteLine: {
    height: 4,
    width: '100%',
    borderRadius: 2,
  },
  diRouteDot: {
    position: 'absolute',
    width: 11,
    height: 11,
    borderRadius: 5.5,
  },
  diRouteStats: {
    alignItems: 'flex-end',
    minWidth: 50,
  },
  diRouteDuration: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  diRouteDistance: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 13,
  },
  previewVerdict: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    marginBottom: 6,
  },
  previewVerdictDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  previewVerdictTxt: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  previewHintTxt: {
    color: colors.textDimmed,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 17,
  },
  previewDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 4,
  },
  previewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  block: {
    width: '100%',
    marginTop: 14,
    alignItems: 'stretch',
  },
});

export default ScanPreview;
