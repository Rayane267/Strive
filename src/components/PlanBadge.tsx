/**
 * Pastille de palier — affiche l'abonnement du chauffeur : Free, Plus ou Premium.
 *
 * À ne pas confondre avec `PlusBadge`, qui est un cadenas : celui-là marque une
 * fonctionnalité réservée, celui-ci dit qui vous êtes.
 *
 * Le logo remplace la couronne. La couronne est un symbole générique de
 * « premium » qu'on trouve dans n'importe quelle app ; la marque, elle,
 * n'appartient qu'à Strive. Et les trois paliers sont nommés tels quels : un
 * « Plus » affiché à un abonné Premium lui donnerait l'impression d'avoir été
 * déclassé.
 *
 * Le composant lit le profil lui-même plutôt que de recevoir un booléen : les
 * quatre écrans qui l'utilisaient recalculaient chacun leur `isPremium`, et un
 * booléen ne sait de toute façon pas distinguer Plus de Premium.
 */

import React from 'react';
import { View, Text, Image, StyleSheet, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getEffectivePlanTier } from '../services/subscriptionService';

const PlanBadge: React.FC<{ style?: ViewStyle }> = ({ style }) => {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const tier = getEffectivePlanTier(profile);

  const label =
    tier === 'premium' ? t('tier.premiumName', 'Premium')
    : tier === 'plus' ? t('tier.plusName', 'Plus')
    : t('tier.freeBadge', 'Free');

  return (
    <View style={[styles.badge, style]} accessible accessibilityRole="text" accessibilityLabel={label}>
      <Image source={require('../assets/strive-logo.png')} style={styles.logo} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  logo: { width: 22, height: 22, borderRadius: 11 },
  text: {
    color: colors.textMain,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
});

export default PlanBadge;
