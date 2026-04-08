/**
 * Bandeau affiché quand l'appareil est hors-ligne.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useTranslation } from 'react-i18next';

const OfflineBanner: React.FC = () => {
  const { isConnected } = useNetworkStatus();
  const { t } = useTranslation();

  if (isConnected) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLabel={t('network.offline', 'No internet connection')}>
      <Feather name="wifi-off" size={14} color="#FFF" />
      <Text style={styles.text}>{t('network.offline', 'No internet connection')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EF4444',
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  text: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default OfflineBanner;
