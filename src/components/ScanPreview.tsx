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
 * Les valeurs sont crédibles et non arrondies : une démonstration dont les
 * chiffres ne tombent pas juste se retourne contre le produit qu'elle vend.
 *
 * ELLES SONT DÉRIVÉES DU PLANCHER DU MARCHÉ, pas écrites en dur.
 *
 * Toute la démonstration tient à la carte du MILIEU : elle passe au kilomètre
 * et échoue à l'heure, et c'est ça, le « peut-être » qu'elle illustre. Les trois
 * cartes étaient calées sur le plancher français (25 €/h, 1,10 €/km) : au
 * Royaume-Uni, où le plancher est à 16 £/h et 1,13 £/mile, la même course passait
 * les DEUX critères et la nuance disparaissait — l'app se montrait en train de
 * dire « peut-être » à une bonne course.
 *
 * Les trois cartes sont donc posées en MULTIPLES du plancher (`×2,28` à l'heure
 * pour la verte, `×0,76` pour l'orange…), ces multiples étant exactement ceux
 * que donnaient les valeurs françaises d'origine. Le tarif se déduit ensuite de
 * la durée, et la distance du tarif : `hourly` et `km` restent DÉRIVÉS de ce
 * qu'on affiche à côté, ils ne s'inventent pas. En France ça donne 17 € pour
 * 18 min, soit 57 €/h et 2,88 €/km sur 5,9 km.
 *
 * La rouge échouait déjà aux deux critères et continue. Elle affichait
 * autrefois 22 € pour 15 €/h et 0,78 €/km : deux valeurs qui ne dérivaient de
 * rien, et 22 € sur 42 min font en réalité 31 €/h avec 2,14 €/km, soit une
 * EXCELLENTE course étiquetée « à éviter ». La démonstration se contredisait.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMarketT } from '../hooks/useMarketT';
import { colors } from '../theme/colors';
import { hapticLight } from '../utils/haptics';
import { useMarket } from '../hooks/useMarket';
import { formatMoney, toMarketDistance, type Market } from '../utils/market';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { strokeWidth } from '../theme/stroke';

/**
 * Les trois cartes, en multiples du plancher du marché.
 *
 * `hourlyX` et `rateX` viennent des valeurs françaises d'origine rapportées au
 * plancher de l'époque : 57/25 = 2,28 ; 3,15/1,10 = 2,864. Les durées, elles,
 * sont absolues — une course de 18 minutes en est une partout.
 */
const PREVIEW_SHAPE = [
  { hourlyX: 2.28,  rateX: 2.864, duration: 18, color: '#00C752', icon: 'check' as const,          verdictKey: 'tutorial.iosPreview.verdictTake',  hintKey: 'tutorial.iosPreview.hintGood' },
  { hourlyX: 0.76,  rateX: 1.173, duration: 28, color: '#FF9900', icon: 'alert-triangle' as const, verdictKey: 'tutorial.iosPreview.verdictMaybe', hintKey: 'tutorial.iosPreview.hintAverage' },
  { hourlyX: 0.64,  rateX: 0.973, duration: 42, color: '#F04444', icon: 'x' as const,              verdictKey: 'tutorial.iosPreview.verdictSkip',  hintKey: 'tutorial.iosPreview.hintBad' },
] as const;

export function buildPreviewData(market: Market) {
  const floor = market.thresholds;
  return PREVIEW_SHAPE.map(c => {
    // Le tarif d'abord, arrondi à l'euro — c'est ce qu'affiche une offre.
    const fare = Math.round((floor.hourly * c.hourlyX * c.duration) / 60);
    // Puis on RELIT l'horaire et le kilométrique depuis ce tarif : ce que la
    // maquette montre doit se vérifier de tête avec les deux autres chiffres.
    const hourly = Math.round((fare * 60) / c.duration);
    // `floor.distance` est un seuil PAR KILOMÈTRE sur les six marchés, Royaume-Uni
    // compris — `utils/market.ts` le pose ainsi pour que la comparaison au
    // `km_rate` des courses reste homogène. La distance qu'on en tire est donc
    // en kilomètres, et il faut la ramener à l'unité du chauffeur avant de lui
    // coller « mi » derrière.
    //
    // Sans ça, la maquette britannique montrait une course de 9,7 km étiquetée
    // « 9.7mi » et un taux par kilomètre étiqueté « /mi » : un seuil 1,6× trop
    // bas, sur l'écran même qui explique au chauffeur ce que l'app sait faire.
    const distanceKm = fare / (floor.distance * c.rateX);
    const distance = toMarketDistance(distanceKm, market).toFixed(1);
    return {
      ...c,
      fare,
      hourly,
      distance,
      // Relu depuis la distance AFFICHÉE, et arrondie : les trois chiffres de la
      // carte doivent se vérifier de tête les uns par les autres, dans l'unité
      // que le chauffeur a sous les yeux.
      km: (fare / Number(distance)).toFixed(2),
    };
  });
}

const ScanPreview = ({ style }: { style?: StyleProp<ViewStyle> }) => {
  const { t } = useMarketT();
  const market = useMarket();
  const [idx, setIdx] = useState(0);
  const previews = useMemo(() => buildPreviewData(market), [market]);
  const p = previews[idx];

  return (
    <View style={[styles.block, style]}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => { hapticLight(); setIdx((idx + 1) % previews.length); }}
        accessibilityRole="button"
        accessibilityLabel={t(p.verdictKey)}
      >
        <View style={styles.dynamicIsland}>
          <View style={styles.diRowTop}>
            <Text style={styles.diPlatform}>Uber</Text>
            <View style={styles.diHourly}>
              <Text style={styles.diHourlyValue}>{formatMoney(p.hourly, market)}</Text>
              <Text style={styles.diHourlyUnit}>/h</Text>
            </View>
            <View style={{ flex: 1 }} />
            <View style={[styles.diFarePill, { backgroundColor: p.color + '46', borderColor: p.color + 'D9' }]}>
              <Text style={styles.diFarePillTxt}>{formatMoney(p.fare, market)}</Text>
            </View>
            <View style={styles.diKmRate}>
              <Feather name="arrow-up-right" size={11} color={p.color} />
              <Text style={styles.diKmRateTxt}>{market.symbol}{p.km}/{market.distanceUnit}</Text>
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
              <Text style={styles.diRouteDistance}>{p.distance}{market.distanceUnit}</Text>
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
        {previews.map((d, i) => (
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
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: 'rgba(0,0,0,0.92)',
    gap: space.lg,
  },
  diRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  diPlatform: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
    fontWeight: '600',
  },
  diHourly: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.tight,
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
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.full,
    borderWidth: strokeWidth.control,
  },
  diFarePillTxt: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  diKmRate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  diKmRateTxt: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  diRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  diRouteCircle: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
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
    borderRadius: radius.xs,
  },
  diRouteDot: {
    position: 'absolute',
    width: 11,
    height: 11,
    borderRadius: radius.full,
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
    gap: space.sm,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  previewVerdictDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
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
    marginBottom: space.md,
    lineHeight: 17,
  },
  previewDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
    marginBottom: space.xs,
  },
  previewDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  block: {
    width: '100%',
    marginTop: space.md,
    alignItems: 'stretch',
  },
});

export default ScanPreview;
