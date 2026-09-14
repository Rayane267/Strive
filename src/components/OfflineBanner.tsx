/**
 * Bandeau affiché quand l'appareil est hors-ligne.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useTranslation } from 'react-i18next';
import { space } from '../theme/spacing';

const OfflineBanner: React.FC = React.memo(() => {
  const { isConnected } = useNetworkStatus();
  const { t } = useTranslation();

  if (isConnected) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLabel={t('network.offline', 'No internet connection')}>
      <Feather name="wifi-off" size={14} color="#FFF" />
      <Text style={styles.text}>{t('network.offline', 'No internet connection')}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: '#EF4444',
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  text: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default OfflineBanner;
