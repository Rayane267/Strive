/**
 * Graphique en barres des gains par jour.
 * Rendu entièrement en View/Text natif (pas de dépendance chart externe).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';

interface DayData {
  label: string;      // ex: "Lun", "Mar"
  earnings: number;   // euros
  isToday?: boolean;
}

interface Props {
  data: DayData[];
  title: string;
}

const EarningsChart: React.FC<Props> = ({ data, title }) => {
  if (data.length === 0) return null;

  const maxVal = Math.max(...data.map(d => d.earnings), 1);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.chartArea}>
        {/* Y-axis labels */}
        <View style={styles.yAxis}>
          <Text style={styles.yLabel}>€{Math.round(maxVal)}</Text>
          <Text style={styles.yLabel}>€{Math.round(maxVal / 2)}</Text>
          <Text style={styles.yLabel}>€0</Text>
        </View>
        {/* Bars */}
        <View style={styles.barsContainer}>
          {/* Grid lines */}
          <View style={[styles.gridLine, { bottom: '100%' }]} />
          <View style={[styles.gridLine, { bottom: '50%' }]} />
          <View style={[styles.gridLine, { bottom: 0 }]} />
          {data.map((day, i) => {
            const heightPct = maxVal > 0 ? (day.earnings / maxVal) * 100 : 0;
            return (
              <View key={i} style={styles.barCol}>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: `${Math.max(heightPct, 2)}%`,
                        backgroundColor: day.isToday ? colors.primary : 'rgba(0,230,118,0.35)',
                      },
                    ]}
                  />
                </View>
                <Text
                  style={[
                    styles.barLabel,
                    day.isToday && styles.barLabelToday,
                  ]}
                >
                  {day.label}
                </Text>
                {day.earnings > 0 && (
                  <Text style={styles.barValue}>€{Math.round(day.earnings)}</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.xl,
    marginBottom: space.lg,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
  },
  title: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: space.xl,
  },
  chartArea: {
    flexDirection: 'row',
    height: 160,
  },
  yAxis: {
    width: 40,
    justifyContent: 'space-between',
    paddingBottom: space.xl,
  },
  yLabel: {
    color: colors.textDimmed,
    fontSize: 10,
    fontWeight: '500',
  },
  barsContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingBottom: space.xl,
    gap: space.xs,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    width: '70%',
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: radius.xs,
    minHeight: 4,
  },
  barLabel: {
    color: colors.textDimmed,
    fontSize: 10,
    fontWeight: '600',
    marginTop: space.sm,
  },
  barLabelToday: {
    color: colors.primary,
    fontWeight: '800',
  },
  barValue: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
    marginTop: space.tight,
    position: 'absolute',
    top: -14,
  },
});

export default EarningsChart;
