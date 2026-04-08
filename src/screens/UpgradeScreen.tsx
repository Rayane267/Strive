import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../theme/colors';

// 1. IMPORTS
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';

const UpgradeScreen = () => {
  // 2. INITIALISATIONS
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {/* Ajout du bouton pour fermer la page (Retour) */}
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Feather name="x" size={24} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('upgrade.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroSection}>
          <View style={styles.iconShield}>
            <MaterialCommunityIcons
              name="star-shooting"
              size={32}
              color={colors.primary}
            />
          </View>
          <Text style={styles.heroTitle}>{t('upgrade.unlock')}</Text>
          <Text style={styles.heroSubtitle}>{t('upgrade.unlockSub')}</Text>
        </View>

        {/* Free Plan Card */}
        <View style={styles.planCard}>
          <View style={styles.planHeader}>
            <Text style={styles.planName}>{t('upgrade.starter')}</Text>
            <View style={styles.freeBadge}>
              <Text style={styles.freeBadgeText}>{t('upgrade.free')}</Text>
            </View>
          </View>
          <View style={styles.featureItem}>
            <Feather name="check-circle" size={18} color={colors.textMuted} />
            <Text style={styles.featureText}>{t('upgrade.feat1')}</Text>
          </View>
          <View style={styles.featureItem}>
            <Feather name="check-circle" size={18} color={colors.textMuted} />
            <Text style={styles.featureText}>{t('upgrade.feat2')}</Text>
          </View>
          <View style={styles.featureItem}>
            <Feather name="check-circle" size={18} color={colors.textMuted} />
            <Text style={styles.featureText}>{t('upgrade.feat3')}</Text>
          </View>
        </View>

        {/* Pro Plan Card */}
        <View style={[styles.planCard, styles.proCard]}>
          <View style={styles.popularBadge}>
            <Text style={styles.popularText}>{t('upgrade.popular')}</Text>
          </View>
          <View style={styles.planHeader}>
            <Text style={styles.planName}>{t('upgrade.proDriver')}</Text>
            <View style={styles.priceContainer}>
              <Text style={styles.priceText}>$9.99</Text>
              <Text style={styles.periodText}>{t('upgrade.perMonth')}</Text>
            </View>
          </View>
          <View style={styles.featureItem}>
            <Feather name="check-circle" size={18} color={colors.primary} />
            <Text style={styles.featureTextPro}>{t('upgrade.proFeat1')}</Text>
          </View>
          <View style={styles.featureItem}>
            <Feather name="check-circle" size={18} color={colors.primary} />
            <Text style={styles.featureTextPro}>{t('upgrade.proFeat2')}</Text>
          </View>
          <View style={styles.featureItem}>
            <Feather name="check-circle" size={18} color={colors.primary} />
            <Text style={styles.featureTextPro}>{t('upgrade.proFeat3')}</Text>
          </View>
          <View style={styles.featureItem}>
            <Feather name="check-circle" size={18} color={colors.primary} />
            <Text style={styles.featureTextPro}>{t('upgrade.proFeat4')}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.upgradeButton}
          onPress={() => navigation.navigate('SubscriptionScreen')}
          activeOpacity={0.85}
        >
          <Text style={styles.upgradeButtonText}>{t('upgrade.goPremium')}</Text>
          <Feather name="arrow-right" size={20} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.restoreBtn} onPress={() => navigation.navigate('SubscriptionScreen')}>
          <Text style={styles.restoreText}>{t('upgrade.restore')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

// ... Styles d'origine conservés ...
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  headerTitle: { color: colors.textMain, fontSize: 18, fontWeight: 'bold' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  heroSection: { alignItems: 'center', marginVertical: 30 },
  iconShield: {
    width: 64,
    height: 64,
    backgroundColor: 'rgba(0, 230, 118, 0.1)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  heroTitle: {
    color: colors.textMain,
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  heroSubtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.surfaceLight,
  },
  proCard: {
    borderColor: colors.primary,
    borderWidth: 2,
    position: 'relative',
    marginTop: 15,
  },
  popularBadge: {
    position: 'absolute',
    top: -12,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  popularText: {
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  planName: { color: colors.textMain, fontSize: 20, fontWeight: 'bold' },
  freeBadge: {
    backgroundColor: '#1A2920',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  freeBadgeText: { color: colors.textMuted, fontSize: 12, fontWeight: 'bold' },
  priceContainer: { alignItems: 'flex-end' },
  priceText: { color: colors.primary, fontSize: 24, fontWeight: 'bold' },
  periodText: { color: colors.textMuted, fontSize: 12 },
  featureItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  featureText: { color: colors.textMuted, fontSize: 14, marginLeft: 10 },
  featureTextPro: {
    color: colors.textMain,
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 10,
  },
  upgradeButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
    borderRadius: 12,
    marginTop: 10,
  },
  upgradeButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: 10,
  },
  restoreBtn: { marginTop: 20, alignItems: 'center' },
  restoreText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
});

export default UpgradeScreen;
