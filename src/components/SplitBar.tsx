import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { useReduceMotion } from '../hooks/useReduceMotion';

export interface SplitSegment {
  key: string;
  /** Part du total, entre 0 et 1. */
  ratio: number;
  color: string;
  label: string;
  /** Montant déjà formaté — le composant ne connaît pas la langue. */
  amount: string;
  /** La part du chauffeur qui regarde. Elle seule est écrite en blanc. */
  mine?: boolean;
}

/**
 * La barre segmentée d'une répartition.
 *
 * Elle existe parce qu'une commission écrite en toutes lettres au fond d'un menu
 * n'est pas une information, c'est une mention légale : on peut la produire en
 * cas de litige sans que personne ne l'ait jamais lue. Une barre montre les
 * proportions AVANT le geste, à l'endroit où le chauffeur décide.
 *
 * Les segments ne portent donc pas de pourcentage écrit dessus : c'est leur
 * LARGEUR qui dit la proportion, et la légende dessous qui donne le centime.
 * Écrire « 2 % » sur sept pixels reviendrait à ne rien montrer du tout.
 *
 * Une seule part est en blanc, celle du chauffeur qui regarde. Le reste recule.
 * Quand tout est au maximum de contraste, plus rien ne mène.
 */
/** Gouttière entre deux parts. Elle sépare, elle ne compte pas dans la mesure. */
const GAP = 3;

const SplitBar = ({
  segments,
  height = 14,
}: {
  segments: SplitSegment[];
  height?: number;
}) => {
  const reduceMotion = useReduceMotion();
  const grow = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  /**
   * Largeur mesurée du rail.
   *
   * Les parts sont calculées en pixels, pas en pourcentages, et c'est la
   * correction d'un défaut qui se voyait : à 88 % + 10 % + 2 % en pourcentages,
   * les deux gouttières poussaient le total au-delà de la largeur du rail et
   * `overflow: hidden` rognait la DERNIÈRE part — celle de Strive, précisément
   * celle que l'écran doit rendre vérifiable. On retire donc les gouttières de
   * la mesure avant de répartir.
   */
  const [trackW, setTrackW] = useState(0);
  const inner = Math.max(
    0,
    trackW - GAP * (segments.length - 1) - 2 * StyleSheet.hairlineWidth,
  );

  useEffect(() => {
    if (reduceMotion || trackW === 0) return;
    Animated.spring(grow, {
      toValue: 1,
      // Une largeur n'est pas animable par le driver natif.
      useNativeDriver: false,
      tension: 40,
      friction: 9,
    }).start();
    // Déploiement joué une fois la largeur connue : la barre se remplit dans
    // l'ordre des parts, elle ne rejoue pas à chaque frappe sur le prix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackW]);

  return (
    <View>
      <View
        style={[styles.track, { height, borderRadius: radius.full }]}
        onLayout={e => setTrackW(e.nativeEvent.layout.width)}
      >
        {trackW > 0 &&
          segments.map((s, i) => {
            const ratio = Math.max(0, Math.min(1, s.ratio));
            // Plancher : une part de 2 % reste une pastille visible et non un
            // trait. En dessous de 6 px, elle ne se lit plus comme une part.
            const w = ratio > 0 ? Math.max(6, inner * ratio) : 0;
            return (
              <Animated.View
                key={s.key}
                style={{
                  width: grow.interpolate({ inputRange: [0, 1], outputRange: [0, w] }),
                  height: '100%',
                  backgroundColor: s.color,
                  borderRadius: radius.full,
                  marginRight: i === segments.length - 1 ? 0 : GAP,
                }}
              />
            );
          })}
      </View>

      <View style={styles.legend}>
        {segments.map(s => (
          <View key={s.key} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Text
              style={[styles.legendLabel, s.mine && styles.legendLabelMine]}
              numberOfLines={1}
            >
              {s.label}
            </Text>
            <Text style={styles.legendPct}>{Math.round(s.ratio * 100)} %</Text>
            <Text style={[styles.legendAmount, s.mine && styles.legendAmountMine]}>
              {s.amount}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: strokeWidth.surface,
    borderColor: stroke.edge,
  },
  legend: { marginTop: space.md, gap: space.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  legendLabel: { flex: 1, color: colors.textMuted, fontSize: 13, minWidth: 0 },
  legendLabelMine: { color: colors.textMain, fontWeight: '700' },
  // Largeur fixe : les trois pourcentages s'alignent en colonne, sinon « 2 % »
  // et « 88 % » font zigzaguer la lecture verticale.
  legendPct: {
    width: 42,
    textAlign: 'right',
    color: colors.textDimmed,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  legendAmount: {
    width: 74,
    textAlign: 'right',
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  legendAmountMine: { color: colors.textMain },
});

export default SplitBar;
