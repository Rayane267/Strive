import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Toast, useToast } from '../components/Toast';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { SCAN_PACKS, getEffectivePlanTier } from '../services/subscriptionService';
import { buyScanPack, restorePurchases, getStorePrices, isIAPAvailable } from '../services/iapService';
import { waitForProfileUpdate } from '../services/profileService';

// Flip à `true` quand la boutique sera prête. Tant que false, l'onglet reste
// visible mais affiche un placeholder "Bientôt disponible".
const SHOP_AVAILABLE = false;

const ShopScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const tabBarHeight = useBottomTabBarHeight();
  const { user, profile, refreshProfile } = useAuth();
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [storePrices, setStorePrices] = useState<Record<string, string>>({});
  const { toast, showToast, dismissToast } = useToast();

  const tier = getEffectivePlanTier(profile);
  const extraCredits = profile?.extra_scan_credits ?? 0;

  // Fetch real store prices from RevenueCat if available
  useEffect(() => {
    if (!isIAPAvailable()) return;
    getStorePrices().then(setStorePrices).catch(() => {});
  }, []);

  const getPriceLabel = (pack: typeof SCAN_PACKS[number]): string =>
    storePrices[pack.productId] || pack.priceLabel;

  const handlePurchase = async (pack: typeof SCAN_PACKS[number]) => {
    if (!user) return;
    setPurchasing(pack.id);
    try {
      const before = profile?.extra_scan_credits ?? 0;
      await buyScanPack(pack.productId);
      // Attend que le webhook RC ait crédité les scans en DB.
      await waitForProfileUpdate(user.id, p => (p.extra_scan_credits ?? 0) > before);
      await refreshProfile();
      showToast({
        type: 'success',
        title: t('shop.purchaseSuccess'),
        message: t('shop.creditsAdded', { count: pack.quantity }),
      });
    } catch (e: any) {
      if (e?.message === 'CANCELLED') return; // user cancelled — silent
      if (e?.message === 'IAP_NOT_AVAILABLE') {
        showToast({ type: 'error', title: t('shop.purchaseError'), message: t('iap.notAvailable') });
      } else {
        showToast({ type: 'error', title: t('shop.purchaseError'), message: t('shop.purchaseErrorMsg') });
      }
    } finally {
      setPurchasing(null);
    }
  };

  const handleRestore = async () => {
    if (!user) return;
    setRestoring(true);
    try {
      const hasPlus = await restorePurchases(user.id);
      if (hasPlus) {
        await waitForProfileUpdate(user.id, p => p.subscription_tier !== 'free');
      }
      await refreshProfile();
      showToast({
        type: 'success',
        title: hasPlus ? t('iap.restoreSuccess') : t('iap.restoreNone'),
        message: '',
      });
    } catch {
      showToast({ type: 'error', title: t('common.error'), message: t('iap.restoreFail') });
    } finally {
      setRestoring(false);
    }
  };

  if (!SHOP_AVAILABLE) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('shop.title')}</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: tabBarHeight }}>
          <MaterialCommunityIcons name="storefront-outline" size={72} color={colors.primaryInk} />
          <Text style={{ color: colors.textMain, fontSize: 22, fontWeight: 'bold', marginTop: 20, textAlign: 'center' }}>
            {t('shop.comingSoonTitle', 'Bientôt disponible')}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 10, textAlign: 'center', lineHeight: 21 }}>
            {t('shop.comingSoonSub', 'La boutique de crédits sera bientôt accessible.')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('shop.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 16 }]} showsVerticalScrollIndicator={false}>

        {/* CREDITS BALANCE */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceLeft}>
            <MaterialCommunityIcons name="ticket-percent-outline" size={32} color={colors.primaryInk} />
            <View style={styles.balanceTextWrap}>
              <Text style={styles.balanceLabel}>{t('shop.creditsBalance')}</Text>
              <Text style={styles.balanceValue}>{t('shop.extraBalance', { count: extraCredits })}</Text>
            </View>
          </View>
          <View style={[styles.tierBadge, tier === 'premium' && styles.tierBadgePremium, tier === 'plus' && styles.tierBadgePlus]}>
            <Text style={styles.tierBadgeText}>{t(`tier.${tier ?? 'free'}Badge`)}</Text>
          </View>
        </View>

        {/* SCAN PACKS SECTION */}
        <Text style={styles.sectionTitle}>{t('shop.packsTitle')}</Text>
        <Text style={styles.sectionSubtitle}>{t('shop.packsSubtitle')}</Text>

        <View style={styles.packsGrid}>
          {SCAN_PACKS.map(pack => {
            const isPurchasing = purchasing === pack.id;
            const isBestValue = pack.id === 'pack_l';

            return (
              <TouchableOpacity
                key={pack.id}
                style={[styles.packCard, isBestValue && styles.packCardHighlight]}
                onPress={() => handlePurchase(pack)}
                disabled={isPurchasing || purchasing !== null || restoring}
                activeOpacity={0.8}
              >
                {isBestValue && (
                  <View style={styles.bestValueBadge}>
                    <Text style={styles.bestValueText}>{t('shop.bestValue')}</Text>
                  </View>
                )}
                {'savings' in pack && !isBestValue && (
                  <View style={styles.savingsBadge}>
                    <Text style={styles.savingsText}>{pack.savings}</Text>
                  </View>
                )}

                <View style={styles.packIconWrap}>
                  <MaterialCommunityIcons name="qrcode-scan" size={28} color={isBestValue ? colors.background : colors.primary} />
                </View>

                <Text style={[styles.packQuantity, isBestValue && styles.packQuantityHighlight]}>
                  {pack.quantity}
                </Text>
                <Text style={[styles.packUnit, isBestValue && styles.packUnitHighlight]}>
                  {t('shop.scans', { s: pack.quantity > 1 ? 's' : '' })}
                </Text>

                <View style={styles.packDivider} />

                {isPurchasing ? (
                  <ActivityIndicator size="small" color={isBestValue ? colors.background : colors.primary} style={{ marginTop: 8 }} />
                ) : (
                  <Text style={[styles.packPrice, isBestValue && styles.packPriceHighlight]}>
                    {getPriceLabel(pack)}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* HOW IT WORKS */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}><Feather name="info" size={16} color={colors.primaryInk} /></View>
            <Text style={styles.infoText}>{t('shop.info1')}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}><Feather name="clock" size={16} color={colors.primaryInk} /></View>
            <Text style={styles.infoText}>{t('shop.info2')}</Text>
          </View>
          <View style={[styles.infoRow, { marginBottom: 0 }]}>
            <View style={styles.infoIcon}><Feather name="trending-up" size={16} color={colors.primaryInk} /></View>
            <Text style={styles.infoText}>{t('shop.info3')}</Text>
          </View>
        </View>

        {/* UPGRADE BANNER */}
        {tier === 'free' && (
          <TouchableOpacity style={styles.upgradeBanner} onPress={() => navigation.navigate('SubscriptionScreen')} activeOpacity={0.85}>
            <MaterialCommunityIcons name="crown" size={24} color={colors.textMain} />
            <View style={styles.upgradeBannerText}>
              <Text style={styles.upgradeBannerTitle}>{t('shop.upgradeTitle')}</Text>
              <Text style={styles.upgradeBannerSub}>{t('shop.upgradeSubtitle')}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.textMain} />
          </TouchableOpacity>
        )}

        {/* RESTORE PURCHASES */}
        <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} disabled={restoring}>
          {restoring
            ? <ActivityIndicator size="small" color={colors.textDimmed} />
            : <Text style={styles.restoreText}>{t('iap.restoreSuccess').includes('!') ? t('upgrade.restore') : t('upgrade.restore')}</Text>
          }
        </TouchableOpacity>

      </ScrollView>
      <Toast data={toast} onDismiss={dismissToast} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 15,
  },
  headerTitle: { color: colors.textMain, fontSize: 18, fontWeight: 'bold' },
  scrollContent: { paddingHorizontal: 20 },

  balanceCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: 16, padding: 20, marginBottom: 28,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.15)',
  },
  balanceLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  balanceTextWrap: {},
  balanceLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  balanceValue: { color: colors.textMain, fontSize: 22, fontWeight: 'bold' },
  tierBadge: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  tierBadgePlus: { backgroundColor: 'rgba(0,230,118,0.15)', borderWidth: 1, borderColor: 'rgba(0,230,118,0.3)' },
  tierBadgePremium: { backgroundColor: colors.primary },
  tierBadgeText: { color: colors.textMain, fontSize: 11, fontWeight: 'bold', letterSpacing: 1 },

  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: 6 },
  sectionSubtitle: { color: colors.textMuted, fontSize: 13, marginBottom: 20, lineHeight: 18 },

  packsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  packCard: {
    width: '47%', backgroundColor: colors.surface, borderRadius: 16, padding: 18,
    alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    position: 'relative', overflow: 'visible',
  },
  packCardHighlight: { backgroundColor: colors.primary, borderColor: colors.primary },
  bestValueBadge: {
    position: 'absolute', top: -10, backgroundColor: '#FFCA28',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  bestValueText: { color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  savingsBadge: {
    position: 'absolute', top: 10, right: 10,
    backgroundColor: 'rgba(0,230,118,0.2)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  savingsText: { color: colors.primaryInk, fontSize: 10, fontWeight: 'bold' },
  packIconWrap: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: 'rgba(0,230,118,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  packQuantity: { color: colors.textMain, fontSize: 36, fontWeight: '900', lineHeight: 40 },
  packQuantityHighlight: { color: colors.textMain },
  packUnit: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginBottom: 12 },
  packUnitHighlight: { color: 'rgba(0,0,0,0.7)' },
  packDivider: { width: '100%', height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 12 },
  packPrice: { color: colors.textMain, fontSize: 18, fontWeight: '900' },
  packPriceHighlight: { color: colors.textMain },

  infoCard: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 18, marginBottom: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  infoIcon: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: 'rgba(0,230,118,0.1)', justifyContent: 'center', alignItems: 'center',
    marginRight: 12, flexShrink: 0,
  },
  infoText: { color: colors.textMuted, fontSize: 13, lineHeight: 18, flex: 1 },

  upgradeBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.primary, borderRadius: 16, padding: 18, gap: 14, marginBottom: 16,
  },
  upgradeBannerText: { flex: 1 },
  upgradeBannerTitle: { color: colors.textMain, fontSize: 15, fontWeight: 'bold', marginBottom: 2 },
  upgradeBannerSub: { color: 'rgba(0,0,0,0.6)', fontSize: 12 },

  restoreBtn: { alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
  restoreText: { color: colors.textDimmed, fontSize: 13 },
});

export default ShopScreen;
