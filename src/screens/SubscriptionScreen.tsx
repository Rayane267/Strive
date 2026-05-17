import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { Toast, useToast } from '../components/Toast';
import { useTranslation } from 'react-i18next';
import { buyPlus, restorePurchases, getStorePrices, isIAPAvailable, IAP_PRODUCTS } from '../services/iapService';
import { waitForProfileUpdate } from '../services/profileService';
import { hapticSuccess, hapticError } from '../utils/haptics';

// ─── Data ─────────────────────────────────────────────────────────────────────

type RowVal = string | false;

// ─── Screen ───────────────────────────────────────────────────────────────────

const SubscriptionScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const [purchasing, setPurchasing] = useState(false);
  const [storePrice, setStorePrice] = useState<string | null>(null);
  const { toast, showToast, dismissToast } = useToast();

  // Fetch real price from store (App Store / Play Store) via RevenueCat.
  // Tombe en silence si RC pas dispo / SKU pas créé → on garde le fallback i18n.
  useEffect(() => {
    if (!isIAPAvailable()) return;
    getStorePrices()
      .then(prices => {
        const p = prices[IAP_PRODUCTS.PLUS_MONTHLY];
        if (p) setStorePrice(p);
      })
      .catch(() => {});
  }, []);

  const plusPriceLabel = storePrice ?? t('subscription.plusPrice');

  const ROWS: { icon: string; label: string; free: RowVal; plus: RowVal }[] = [
    { icon: 'zap',         label: t('subscription.rows.scans.label'),     free: t('subscription.rows.scans.free'),     plus: t('subscription.rows.scans.plus')     },
    { icon: 'monitor',     label: t('subscription.rows.dashboard.label'), free: t('subscription.rows.dashboard.free'), plus: t('subscription.rows.dashboard.plus') },
    { icon: 'droplet',     label: t('subscription.rows.fuel.label'),      free: false,                                  plus: t('subscription.rows.fuel.plus')      },
    { icon: 'target',      label: t('subscription.rows.goal.label'),      free: false,                                  plus: t('subscription.rows.goal.plus')      },
    { icon: 'clock',       label: t('subscription.rows.history.label'),   free: t('subscription.rows.history.free'),   plus: t('subscription.rows.history.plus')   },
    { icon: 'trending-up', label: t('subscription.rows.hourly.label'),    free: false,                                  plus: t('subscription.rows.hourly.plus')    },
    { icon: 'life-buoy',   label: t('subscription.rows.support.label'),   free: false,                                  plus: t('subscription.rows.support.plus')   },
  ];

  const [restoring, setRestoring] = useState(false);

  const handlePurchase = async () => {
    if (!user) return;
    setPurchasing(true);
    try {
      await buyPlus(user.id);
      // Attend que le webhook RC ait propagé l'update du tier en DB.
      await waitForProfileUpdate(user.id, p => p.subscription_tier !== 'free');
      await refreshProfile();
      hapticSuccess();
      navigation.goBack();
    } catch (e: any) {
      if (e?.message === 'CANCELLED') return;
      hapticError();
      showToast({ type: 'error', title: t('subscription.errorTitle'), message: t('subscription.errorMsg') });
    } finally {
      setPurchasing(false);
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
      if (hasPlus) hapticSuccess();
      showToast({
        type: 'success',
        title: hasPlus ? t('iap.restoreSuccess') : t('iap.restoreNone'),
        message: '',
      });
      if (hasPlus) navigation.goBack();
    } catch {
      hapticError();
      showToast({ type: 'error', title: t('common.error'), message: t('iap.restoreFail') });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />

      {/* ── CLOSE ── */}
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.closeBtn}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Feather name="x" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── HERO ── */}
        <View style={styles.hero}>
          <LinearGradient
            colors={['rgba(0,230,118,0.12)', 'transparent']}
            style={styles.heroGlow}
            pointerEvents="none"
          />
          <View style={styles.crownRow}>
            <LinearGradient colors={[colors.primary, '#00C96A']} style={styles.crownBadge}>
              <MaterialCommunityIcons name="crown" size={16} color="#000" />
            </LinearGradient>
            <Text style={styles.crownLabel}>{t('subscription.label')}</Text>
          </View>
          <Text style={styles.heroTitle}>{t('subscription.heroTitle')}</Text>
          <Text style={styles.heroSub}>{t('subscription.heroSub')}</Text>
        </View>

        {/* ── COMPARISON TABLE ── */}
        <View style={styles.tableContainer}>

          {/* Column headers */}
          <View style={styles.tableHeader}>
            <View style={styles.headerLabel} />

            {/* Free header */}
            <View style={styles.headerFree}>
              <Text style={styles.headerFreeTitle}>{t('subscription.freeHeader')}</Text>
              <Text style={styles.headerFreePrice}>{t('subscription.freePrice')}</Text>
            </View>

            {/* Plus header */}
            <LinearGradient
              colors={['#0E2D1C', '#0A2015']}
              style={styles.headerPlus}
            >
              <View style={styles.headerPlusCrown}>
                <MaterialCommunityIcons name="crown" size={10} color="#000" />
              </View>
              <Text style={styles.headerPlusTitle}>{t('subscription.plusHeader')}</Text>
              <Text style={styles.headerPlusPrice}>{plusPriceLabel}</Text>
              <Text style={styles.headerPlusFreq}>{t('subscription.plusFreq')}</Text>
            </LinearGradient>
          </View>

          {/* Feature rows */}
          {ROWS.map((row, i) => {
            const isLast = i === ROWS.length - 1;
            return (
              <View
                key={i}
                style={[styles.tableRow, i % 2 !== 0 && styles.tableRowShade]}
              >
                {/* Label */}
                <View style={styles.rowLabel}>
                  <Feather name={row.icon as any} size={13} color={colors.textDimmed} style={styles.rowIcon} />
                  <Text style={styles.rowLabelText} numberOfLines={1}>{row.label}</Text>
                </View>

                {/* Free cell */}
                <View style={[styles.cell, isLast && styles.cellFreeLastRadius]}>
                  {row.free === false ? (
                    <View style={styles.lockWrap}>
                      <Feather name="lock" size={13} color="rgba(255,255,255,0.18)" />
                    </View>
                  ) : (
                    <Text style={styles.cellFreeText}>{row.free as string}</Text>
                  )}
                </View>

                {/* Plus cell */}
                <View style={[styles.cell, styles.cellPlus, isLast && styles.cellPlusLastRadius]}>
                  {row.plus === false ? (
                    <View style={styles.lockWrap}>
                      <Feather name="lock" size={13} color="rgba(255,255,255,0.18)" />
                    </View>
                  ) : (
                    <Text style={styles.cellPlusText}>{row.plus}</Text>
                  )}
                </View>
              </View>
            );
          })}

          {/* Table bottom border */}
          <View style={styles.tableBottom} />
        </View>

        {/* ── PROOF ── */}
        <View style={styles.proofCard}>
          <View style={styles.proofAvatars}>
            {['#4A90E2', '#F5A623', '#D0021B'].map((c, i) => (
              <View key={i} style={[styles.proofAvatar, { backgroundColor: c, marginLeft: i > 0 ? -8 : 0 }]} />
            ))}
          </View>
          <Text style={styles.proofText}>
            <Text style={styles.proofBold}>{t('subscription.proofBold')}</Text>{' '}{t('subscription.proofSuffix')}
          </Text>
        </View>

        <View style={{ height: 130 }} />
      </ScrollView>

      {/* ── STICKY BOTTOM ── */}
      <View style={styles.stickyBottom}>

        {/* Price hint */}
        <View style={styles.priceHint}>
          <Text style={styles.priceHintLeft}>{t('subscription.priceLabel')}</Text>
          <Text style={styles.priceHintRight}>{t('subscription.priceDetail', { price: plusPriceLabel })}</Text>
        </View>

        {/* CTA button */}
        <TouchableOpacity
          onPress={handlePurchase}
          disabled={purchasing}
          activeOpacity={0.88}
          style={styles.ctaTouch}
        >
          <LinearGradient
            colors={purchasing ? [colors.surface, colors.surface] : [colors.primary, '#00C96A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaGradient}
          >
            {purchasing ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <MaterialCommunityIcons name="crown" size={17} color="#000" />
                <Text style={styles.ctaText}>{t('subscription.cta')}</Text>
                <Feather name="arrow-right" size={16} color="#000" />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Footer links */}
        <View style={styles.footer}>
          <TouchableOpacity onPress={handleRestore} disabled={restoring}>
            {restoring
              ? <ActivityIndicator size="small" color={colors.textDimmed} />
              : <Text style={styles.footerLink}>{t('subscription.restore')}</Text>
            }
          </TouchableOpacity>
          <Text style={styles.footerSep}>·</Text>
          <Text style={styles.footerLink}>{t('subscription.terms')}</Text>
          <Text style={styles.footerSep}>·</Text>
          <Text style={styles.footerLink}>{t('subscription.privacy')}</Text>
        </View>
      </View>

      <Toast data={toast} onDismiss={dismissToast} bottomOffset={40} />
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const COL_FREE = 90;
const COL_PLUS = 104;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  closeBtn: {
    position: 'absolute',
    top: 54,
    right: 20,
    zIndex: 20,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.07)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },

  scroll: { paddingBottom: 20 },

  // ── HERO ──
  hero: {
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 32,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  crownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  crownBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 8,
  },
  crownLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  heroTitle: {
    color: colors.textMain,
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 42,
    letterSpacing: -1,
    marginBottom: 14,
  },
  heroSub: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },

  // ── TABLE ──
  tableContainer: {
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 14,
  },

  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerLabel: { flex: 1 },

  headerFree: {
    width: COL_FREE,
    paddingVertical: 16,
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  headerFreeTitle: { color: colors.textDimmed, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  headerFreePrice: { color: colors.textMuted, fontSize: 18, fontWeight: '900' },

  headerPlus: {
    width: COL_PLUS,
    paddingVertical: 16,
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(0,230,118,0.18)',
  },
  headerPlusCrown: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerPlusTitle: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  headerPlusPrice: { color: colors.textMain, fontSize: 18, fontWeight: '900', marginTop: 4 },
  headerPlusFreq: { color: colors.primary, fontSize: 10, fontWeight: '700' },

  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    backgroundColor: colors.surface,
  },
  tableRowShade: { backgroundColor: '#12201A' },
  tableBottom: { height: 0 },

  rowLabel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingLeft: 14,
    paddingRight: 8,
  },
  rowIcon: { marginRight: 9 },
  rowLabelText: {
    color: colors.textMain,
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },

  cell: {
    width: COL_FREE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.015)',
  },
  cellFreeLastRadius: {
    borderBottomLeftRadius: 0,
  },
  cellPlus: {
    width: COL_PLUS,
    backgroundColor: 'rgba(0,230,118,0.055)',
    borderLeftColor: 'rgba(0,230,118,0.12)',
  },
  cellPlusLastRadius: {
    borderBottomRightRadius: 0,
  },

  lockWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cellFreeText: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  checkBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  cellPlusText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 4,
  },

  // ── PROOF ──
  proofCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.1)',
  },
  proofAvatars: { flexDirection: 'row' },
  proofAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  proofText: { color: colors.textMuted, fontSize: 12, lineHeight: 18, flex: 1 },
  proofBold: { color: colors.textMain, fontWeight: '700' },

  // ── STICKY BOTTOM ──
  stickyBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 14,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  priceHint: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  priceHintLeft: { color: colors.textMain, fontSize: 14, fontWeight: '700' },
  priceHintRight: { color: colors.textDimmed, fontSize: 12 },

  ctaTouch: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  ctaGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  ctaText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.2,
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  footerLink: { color: 'rgba(255,255,255,0.25)', fontSize: 11 },
  footerSep: { color: 'rgba(255,255,255,0.15)', fontSize: 11 },
});

export default SubscriptionScreen;
