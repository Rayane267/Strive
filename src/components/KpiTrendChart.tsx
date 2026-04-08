/**
 * Mini graphique de tendance pour un KPI (€/h, €/km).
 * Ligne SVG-like dessinée en View natif (pas de dépendance chart).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

interface DataPoint {
  label: string;
  value: number;
}

interface Props {
  data: DataPoint[];
  title: string;
  unit: string;
  color?: string;
}

const KpiTrendChart: React.FC<Props> = ({
  data,
  title,
  unit,
  color = colors.primary,
}) => {
  if (data.length === 0) return null;

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const minVal = Math.min(...data.map(d => d.value), 0);
  const range = maxVal - minVal || 1;
  const currentValue = data[data.length - 1]?.value ?? 0;
  const prevValue = data.length > 1 ? data[data.length - 2]?.value ?? 0 : currentValue;
  const trend = currentValue - prevValue;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.valueRow}>
          <Text style={[styles.currentValue, { color }]}>
            {currentValue.toFixed(2)}{unit}
          </Text>
          {trend !== 0 && (
            <Text style={[styles.trend, { color: trend > 0 ? '#4CAF50' : '#EF4444' }]}>
              {trend > 0 ? '+' : ''}{trend.toFixed(2)}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.chartRow}>
        {data.map((point, i) => {
          const heightPct = ((point.value - minVal) / range) * 100;
          return (
            <View key={i} style={styles.pointCol}>
              <View style={styles.pointTrack}>
                <View
                  style={[
                    styles.pointBar,
                    {
                      height: `${Math.max(heightPct, 5)}%`,
                      backgroundColor: i === data.length - 1 ? color : color + '40',
                    },
                  ]}
                />
              </View>
              <Text style={styles.pointLabel}>{point.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currentValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  trend: {
    fontSize: 12,
    fontWeight: '700',
  },
  chartRow: {
    flexDirection: 'row',
    height: 80,
    alignItems: 'flex-end',
    gap: 4,
  },
  pointCol: {
    flex: 1,
    alignItems: 'center',
  },
  pointTrack: {
    width: '60%',
    height: '100%',
    justifyContent: 'flex-end',
  },
  pointBar: {
    width: '100%',
    borderRadius: 4,
    minHeight: 4,
  },
  pointLabel: {
    color: colors.textDimmed,
    fontSize: 9,
    fontWeight: '500',
    marginTop: 4,
  },
});

export default KpiTrendChart;
