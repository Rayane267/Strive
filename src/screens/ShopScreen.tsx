import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Toast, useToast } from '../components/Toast';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { useAuth } from '../context/AuthContext';
import { SCAN_PACKS, getEffectivePlanTier } from '../services/subscriptionService';
import { buyScanPack, restorePurchases, getStorePrices, isIAPAvailable } from '../services/iapService';
import { waitForProfileUpdate } from '../services/profileService';
import { FIELD_TOP } from '../theme/field';
import ScreenField from '../components/ScreenField';

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
        {/* Pose en premier, donc derriere tout le reste. Il remplit la zone SOUS
            l'encoche, et `container` porte la meme couleur que son sommet : la
            bande de statut se confond avec lui au lieu de faire un bandeau. */}
        <ScreenField />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('shop.title')}</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxl, paddingBottom: tabBarHeight }}>
          <MaterialCommunityIcons name="storefront-outline" size={72} color={colors.primary} />
          <Text style={{ color: colors.textMain, fontSize: 22, fontWeight: 'bold', marginTop: space.xl, textAlign: 'center' }}>
            {t('shop.comingSoonTitle', 'Bientôt disponible')}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: space.sm, textAlign: 'center', lineHeight: 21 }}>
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
            <MaterialCommunityIcons name="ticket-percent-outline" size={32} color={colors.primary} />
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
                  <ActivityIndicator size="small" color={isBestValue ? colors.background : colors.primary} style={{ marginTop: space.sm }} />
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
            <View style={styles.infoIcon}><Feather name="info" size={16} color={colors.primary} /></View>
            <Text style={styles.infoText}>{t('shop.info1')}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}><Feather name="clock" size={16} color={colors.primary} /></View>
            <Text style={styles.infoText}>{t('shop.info2')}</Text>
          </View>
          <View style={[styles.infoRow, { marginBottom: space.tight }]}>
            <View style={styles.infoIcon}><Feather name="trending-up" size={16} color={colors.primary} /></View>
            <Text style={styles.infoText}>{t('shop.info3')}</Text>
          </View>
        </View>

        {/* UPGRADE BANNER */}
        {tier === 'free' && (
          <TouchableOpacity style={styles.upgradeBanner} onPress={() => navigation.navigate('SubscriptionScreen')} activeOpacity={0.85}>
            <Image
              source={require('../assets/strive-logo.png')}
              style={styles.upgradeBannerLogo}
            />
            <View style={styles.upgradeBannerText}>
              <Text style={styles.upgradeBannerTitle}>{t('shop.upgradeTitle')}</Text>
              <Text style={styles.upgradeBannerSub}>{t('shop.upgradeSubtitle')}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.background} />
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
  container: { flex: 1, backgroundColor: FIELD_TOP },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, paddingVertical: space.lg,
  },
  headerTitle: { color: colors.textMain, fontSize: 18, fontWeight: 'bold' },
  scrollContent: { paddingHorizontal: space.xl },

  balanceCard: {
    backgroundColor: colors.surface,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    overflow: 'hidden',
  },
  balanceLeft: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  balanceTextWrap: {},
  balanceLabel: { color: colors.textMuted, fontSize: 12, marginBottom: space.xs },
  balanceValue: { color: colors.textMain, fontSize: 22, fontWeight: 'bold' },
  tierBadge: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg },
  tierBadgePlus: { backgroundColor: 'rgba(0,230,118,0.15)', borderWidth: strokeWidth.control, borderColor: stroke.edge },
  tierBadgePremium: { backgroundColor: colors.primary },
  tierBadgeText: { color: colors.textMain, fontSize: 11, fontWeight: 'bold', letterSpacing: 1 },

  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: space.sm },
  sectionSubtitle: { color: colors.textMuted, fontSize: 13, marginBottom: space.xl, lineHeight: 18 },

  packsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.xl },
  packCard: {
    backgroundColor: colors.surface,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    position: 'relative', overflow: 'visible',
  },
  packCardHighlight: { backgroundColor: colors.primary, borderColor: colors.primary },
  bestValueBadge: {
    position: 'absolute', top: -10, backgroundColor: '#FFCA28',
    paddingHorizontal: space.sm, paddingVertical: space.tight, borderRadius: radius.sm,
  },
  bestValueText: { color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  savingsBadge: {
    position: 'absolute', top: 10, right: 10,
    backgroundColor: 'rgba(0,230,118,0.2)', paddingHorizontal: space.sm, paddingVertical: space.tight, borderRadius: radius.xs,
  },
  savingsText: { color: colors.primary, fontSize: 10, fontWeight: 'bold' },
  packIconWrap: {
    width: 52, height: 52, borderRadius: radius.md,
    backgroundColor: 'rgba(0,230,118,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: space.md,
  },
  packQuantity: { color: colors.textMain, fontSize: 36, fontWeight: '900', lineHeight: 40 },
  packQuantityHighlight: { color: colors.background },
  packUnit: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginBottom: space.md },
  packUnitHighlight: { color: 'rgba(0,0,0,0.7)' },
  packDivider: { width: '100%', height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: space.md },
  packPrice: { color: colors.textMain, fontSize: 18, fontWeight: '900' },
  packPriceHighlight: { color: colors.background },

  infoCard: {
    backgroundColor: colors.surface,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    overflow: 'hidden',
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.md },
  infoIcon: {
    width: 28, height: 28, borderRadius: radius.sm,
    backgroundColor: 'rgba(0,230,118,0.1)', justifyContent: 'center', alignItems: 'center',
    marginRight: space.md, flexShrink: 0,
  },
  infoText: { color: colors.textMuted, fontSize: 13, lineHeight: 18, flex: 1 },

  upgradeBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.primary, borderRadius: radius.md, padding: space.lg, gap: space.md, marginBottom: space.lg,
  },
  upgradeBannerLogo: { width: 28, height: 28, borderRadius: radius.full },
  upgradeBannerText: { flex: 1 },
  upgradeBannerTitle: { color: colors.background, fontSize: 15, fontWeight: 'bold', marginBottom: space.tight },
  upgradeBannerSub: { color: 'rgba(0,0,0,0.6)', fontSize: 12 },

  restoreBtn: { alignItems: 'center', paddingVertical: space.md, marginBottom: space.xs },
  restoreText: { color: colors.textDimmed, fontSize: 13 },
});

export default ShopScreen;
