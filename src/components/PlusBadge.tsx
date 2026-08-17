/**
 * Pastille « PLUS » — signale qu'une fonctionnalité est réservée à l'abonnement.
 *
 * Sert à prévenir AVANT l'interaction, pas après : les seuils minimum et les
 * réglages véhicule étaient rendus normalement pour un compte free, la
 * restriction ne se découvrant qu'au moment de les manipuler (curseurs inertes,
 * ou renvoi brutal au paywall). Une seule et même pastille partout, pour que le
 * signal soit reconnaissable d'un écran à l'autre.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';

const PlusBadge: React.FC<{ style?: object }> = ({ style }) => {
  const { t } = useTranslation();
  return (
    <View
      style={[styles.badge, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('tier.plusOnly', 'Réservé à Strive Plus')}
    >
      <Feather name="lock" size={9} color={colors.primaryInk} />
      <Text style={styles.text}>{t('tier.plusBadge', 'PLUS')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,230,118,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.28)',
  },
  text: {
    color: colors.primaryInk,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
});

export default PlusBadge;
