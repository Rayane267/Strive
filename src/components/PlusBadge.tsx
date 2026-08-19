/**
 * Pastille « PLUS » — signale qu'une fonctionnalité est réservée à l'abonnement.
 *
 * Sert à prévenir AVANT l'interaction, pas après : les seuils minimum et les
 * réglages véhicule étaient rendus normalement pour un compte free, la
 * restriction ne se découvrant qu'au moment de les manipuler (curseurs inertes,
 * ou renvoi brutal au paywall). Elle n'utilise pas de cadenas : le niveau Plus
 * est un bénéfice identifiable, pas une erreur ou une permission refusée.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
      <Text style={styles.text}>{t('tier.plusBadge', 'PLUS')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },
  text: {
    color: colors.background,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
});

export default PlusBadge;
