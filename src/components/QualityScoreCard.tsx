import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { QualityScore } from '../utils/qualityScore';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';

const scoreColor = (v: number): string =>
  v >= 75 ? colors.primary : v >= 50 ? '#FF9800' : colors.danger;

interface Props {
  score: QualityScore;
}

const QualityScoreCard = React.memo(({ score }: Props) => {
  const { t } = useTranslation();
  if (score.quality == null) return null;

  const q = score.quality;
  const qColor = scoreColor(q);
  const label =
    q >= 75 ? t('analytics.quality.levelGood', 'Excellent')
    : q >= 50 ? t('analytics.quality.levelMid', 'Correct')
    : t('analytics.quality.levelLow', 'À améliorer');

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Feather name="award" size={16} color={colors.primary} />
          <Text style={styles.title}>{t('analytics.quality.title', 'Qualité des courses')}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: qColor + '22' }]}>
          <Text style={[styles.badgeText, { color: qColor }]}>{label}</Text>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <Text style={[styles.scoreValue, { color: qColor }]}>{q}</Text>
        <Text style={styles.scoreMax}>/100</Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${q}%` as any, backgroundColor: qColor }]} />
      </View>
      <Text style={styles.caption}>
        {t('analytics.quality.caption', {
          count: score.qualitySample,
          defaultValue: 'Sur {{count}} courses acceptées',
        })}
      </Text>

      {score.discipline != null && score.disciplineSample >= 3 && (
        <View style={styles.disciplineRow}>
          <Feather name="target" size={14} color={colors.textMuted} />
          <Text style={styles.disciplineText}>
            {t('analytics.quality.discipline', {
              pct: score.discipline,
              defaultValue: '{{pct}}% de bonnes décisions (accepter/refuser)',
            })}
          </Text>
        </View>
      )}

      {score.missedCount > 0 && (
        <View style={styles.disciplineRow}>
          <Feather name="alert-triangle" size={14} color="#FF9800" />
          <Text style={[styles.disciplineText, { color: '#FF9800' }]}>
            {t('analytics.quality.missed', {
              count: score.missedCount,
              defaultValue: '{{count}} bonne(s) course(s) refusée(s)',
            })}
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.xl,
    marginBottom: space.lg,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: colors.textMain, fontSize: 15, fontWeight: 'bold' },
  badge: { paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm },
  badgeText: { fontSize: 12, fontWeight: '800' },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, marginBottom: space.sm },
  scoreValue: { fontSize: 40, fontWeight: '900', letterSpacing: -1.5 },
  scoreMax: { color: colors.textMuted, fontSize: 16, fontWeight: '700', marginBottom: space.sm },
  track: {
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  fill: { height: 10, borderRadius: radius.xs },
  caption: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: space.sm },
  disciplineRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  disciplineText: { color: colors.textMuted, fontSize: 12, fontWeight: '600', flex: 1 },
});

export default QualityScoreCard;
