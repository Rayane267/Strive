import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Pressable,
  LayoutAnimation,
  Platform,
  UIManager,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SafeGradient from '../components/SafeGradient';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { Toast, useToast } from '../components/Toast';
import { useTranslation } from 'react-i18next';
import {
  buyPlus,
  restorePurchases,
  getPlusPackages,
  checkTrialEligibility,
  isIAPAvailable,
  IAP_PRODUCTS,
  type PlusPackage,
} from '../services/iapService';
import { waitForProfileUpdate } from '../services/profileService';
import { hapticSuccess, hapticError, hapticLight } from '../utils/haptics';

// Active LayoutAnimation côté Android. Sur iOS c'est dispo par défaut.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Cycle = 'monthly' | 'yearly';

const VALUE_PROPS = [
  { icon: 'zap',         titleKey: 'subscription.values.scan.title',      subKey: 'subscription.values.scan.sub' },
  { icon: 'trending-up', titleKey: 'subscription.values.hourly.title',    subKey: 'subscription.values.hourly.sub' },
  { icon: 'x-octagon',   titleKey: 'subscription.values.filter.title',    subKey: 'subscription.values.filter.sub' },
  { icon: 'target',      titleKey: 'subscription.values.threshold.title', subKey: 'subscription.values.threshold.sub' },
] as const;

const FAQ_ITEMS = [1, 2, 3, 4] as const;

const SubscriptionScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const { toast, showToast, dismissToast } = useToast();

  const [cycle, setCycle] = useState<Cycle>('yearly');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [monthly, setMonthly] = useState<PlusPackage | null>(null);
  const [yearly, setYearly] = useState<PlusPackage | null>(null);
  const [trialEligible, setTrialEligible] = useState(false);
  const [openedFaq, setOpenedFaq] = useState<number | null>(null);

  // Pulse subtil sur le CTA — attire l'œil sans devenir agressif (1.0 → 1.04 → 1.0 en 2s, loop infini).
  // useNativeDriver pour ne pas charger le JS thread.
  const ctaScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (purchasing) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaScale, { toValue: 1.035, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(ctaScale, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ctaScale, purchasing]);

  useEffect(() => {
    if (!isIAPAvailable()) return;
    let cancelled = false;
    (async () => {
      const [pkgs, elig] = await Promise.all([
        getPlusPackages(),
        checkTrialEligibility([IAP_PRODUCTS.PLUS_MONTHLY, IAP_PRODUCTS.PLUS_YEARLY]),
      ]);
      if (cancelled) return;
      setMonthly(pkgs.monthly);
      setYearly(pkgs.yearly);
      setTrialEligible(!!elig[IAP_PRODUCTS.PLUS_MONTHLY] || !!elig[IAP_PRODUCTS.PLUS_YEARLY]);
    })();
    return () => { cancelled = true; };
  }, []);

  const savingsPct = useMemo(() => {
    if (!monthly?.rawPrice || !yearly?.rawPrice) return 33;
    const fullYear = monthly.rawPrice * 12;
    if (fullYear <= 0) return 33;
    return Math.max(1, Math.round((1 - yearly.rawPrice / fullYear) * 100));
  }, [monthly, yearly]);

  const activePkg = cycle === 'yearly' ? yearly : monthly;
  const activeProductId = cycle === 'yearly' ? IAP_PRODUCTS.PLUS_YEARLY : IAP_PRODUCTS.PLUS_MONTHLY;

  const mainPriceText =
    activePkg?.priceString ??
    (cycle === 'yearly' ? t('subscription.yearlyFallbackPrice') : t('subscription.monthlyFallbackPrice'));

  const perMonthHint = cycle === 'yearly' ? (yearly?.pricePerMonthString ?? null) : null;

  const handleToggle = (next: Cycle) => {
    if (next === cycle) return;
    hapticLight();
    setCycle(next);
  };

  const handleFaqToggle = (idx: number) => {
    hapticLight();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenedFaq(prev => (prev === idx ? null : idx));
  };

  const handlePurchase = async () => {
    if (!user || purchasing) return;
    setPurchasing(true);
    try {
      await buyPlus(user.id, activeProductId);
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
    if (!user || restoring) return;
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

  const ROWS = [
    { icon: 'zap',         label: t('subscription.rows.scans.label'),     free: t('subscription.rows.scans.free'),     plus: t('subscription.rows.scans.plus')     },
    { icon: 'monitor',     label: t('subscription.rows.dashboard.label'), free: t('subscription.rows.dashboard.free'), plus: t('subscription.rows.dashboard.plus') },
    { icon: 'trending-up', label: t('subscription.rows.hourly.label'),    free: false as const,                         plus: t('subscription.rows.hourly.plus')    },
    { icon: 'clock',       label: t('subscription.rows.history.label'),   free: t('subscription.rows.history.free'),   plus: t('subscription.rows.history.plus')   },
    { icon: 'target',      label: t('subscription.rows.goal.label'),      free: false as const,                         plus: t('subscription.rows.goal.plus')      },
    { icon: 'droplet',     label: t('subscription.rows.fuel.label'),      free: false as const,                         plus: t('subscription.rows.fuel.plus')      },
    { icon: 'life-buoy',   label: t('subscription.rows.support.label'),   free: false as const,                         plus: t('subscription.rows.support.plus')   },
  ];

  const ctaLabel = trialEligible ? t('subscription.ctaTrial') : t('subscription.ctaSubscribe');
  const ctaHint = trialEligible
    ? t('subscription.ctaHintTrial', { price: mainPriceText, cycle: cycle === 'yearly' ? t('subscription.cycleYearly') : t('subscription.cycleMonthly') })
    : t('subscription.ctaHintNoTrial', { cycle: cycle === 'yearly' ? t('subscription.cycleYearly') : t('subscription.cycleMonthly') });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />

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
          <SafeGradient
            colors={['rgba(0,230,118,0.28)', 'rgba(0,230,118,0.08)', 'transparent']}
            style={styles.heroGlow}
            pointerEvents="none"
          />
          <SafeGradient
            colors={['rgba(0,230,118,0.18)', 'transparent']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.heroOrb}
            pointerEvents="none"
          />
          <View style={styles.crownRow}>
            <SafeGradient colors={['#00FF8C', colors.primary, '#00B85A']} style={styles.crownBadge}>
              <MaterialCommunityIcons name="crown" size={18} color="#000" />
            </SafeGradient>
            <Text style={styles.crownLabel}>{t('subscription.label')}</Text>
          </View>
          <Text style={styles.heroTitle}>{t('subscription.heroTitle')}</Text>
          <Text style={styles.heroSub}>{t('subscription.heroSub')}</Text>
        </View>

        {/* ── VALUE PROPS (2x2 grid) ── */}
        <View style={styles.valueGrid}>
          {VALUE_PROPS.map((v, i) => (
            <View key={i} style={styles.valueCard}>
              <SafeGradient
                colors={['#00FF8C', colors.primary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.valueIconWrap}
              >
                <Feather name={v.icon as any} size={18} color="#062318" />
              </SafeGradient>
              <Text style={styles.valueTitle}>{t(v.titleKey)}</Text>
              <Text style={styles.valueSub}>{t(v.subKey)}</Text>
            </View>
          ))}
        </View>

        {/* ── CYCLE TOGGLE ── */}
        <View style={styles.toggleWrap}>
          <Pressable
            onPress={() => handleToggle('monthly')}
            style={[styles.toggleBtn, cycle === 'monthly' && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, cycle === 'monthly' && styles.toggleTextActive]}>
              {t('subscription.monthlyTab')}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => handleToggle('yearly')}
            style={[styles.toggleBtn, cycle === 'yearly' && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, cycle === 'yearly' && styles.toggleTextActive]}>
              {t('subscription.yearlyTab')}
            </Text>
            <View style={styles.savingsBadge}>
              <Text style={styles.savingsBadgeText}>−{savingsPct}%</Text>
            </View>
          </Pressable>
        </View>

        {/* ── PRICING CARD ── */}
        <SafeGradient
          colors={['rgba(0,255,140,0.10)', 'rgba(0,200,90,0.04)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.priceCard}
        >
          {trialEligible && (
            <SafeGradient
              colors={['#A4FF6B', '#00FF8C', colors.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.trialBadge}
            >
              <Feather name="gift" size={13} color="#062318" />
              <Text style={styles.trialBadgeText}>{t('subscription.trialBadge')}</Text>
            </SafeGradient>
          )}

          <View style={styles.priceRow}>
            <Text style={styles.priceMain}>{mainPriceText}</Text>
            <Text style={styles.priceSuffix}>
              {cycle === 'yearly' ? t('subscription.perYearShort') : t('subscription.perMonthShort')}
            </Text>
          </View>

          {perMonthHint && (
            <Text style={styles.priceSub}>
              {t('subscription.perMonthEquiv', { price: perMonthHint })}
            </Text>
          )}

          {cycle === 'monthly' && (
            <Text style={styles.priceSub}>
              {t('subscription.switchYearlyHint', { percent: savingsPct })}
            </Text>
          )}
        </SafeGradient>

        {/* ── COMPARISON ── */}
        <View style={styles.tableContainer}>
          <View style={styles.tableHeader}>
            <View style={styles.headerLabel} />
            <View style={styles.headerFree}>
              <Text style={styles.headerFreeTitle}>{t('subscription.freeHeader')}</Text>
            </View>
            <SafeGradient colors={['#0E2D1C', '#0A2015']} style={styles.headerPlus}>
              <View style={styles.headerPlusCrown}>
                <MaterialCommunityIcons name="crown" size={10} color="#000" />
              </View>
              <Text style={styles.headerPlusTitle}>{t('subscription.plusHeader')}</Text>
            </SafeGradient>
          </View>

          {ROWS.map((row, i) => (
            <View key={i} style={[styles.tableRow, i % 2 !== 0 && styles.tableRowShade]}>
              <View style={styles.rowLabel}>
                <Feather name={row.icon as any} size={13} color={colors.textDimmed} style={styles.rowIcon} />
                <Text style={styles.rowLabelText} numberOfLines={1}>{row.label}</Text>
              </View>
              <View style={styles.cell}>
                {row.free === false ? (
                  <View style={styles.lockWrap}>
                    <Feather name="lock" size={13} color="rgba(255,255,255,0.18)" />
                  </View>
                ) : (
                  <Text style={styles.cellFreeText}>{row.free}</Text>
                )}
              </View>
              <View style={[styles.cell, styles.cellPlus]}>
                <Text style={styles.cellPlusText}>{row.plus as string}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── TRUST SIGNALS ── pills colorées */}
        <View style={styles.trustRow}>
          <View style={styles.trustPill}>
            <Feather name="check-circle" size={13} color={colors.primary} />
            <Text style={styles.trustText}>{t('subscription.trust.cancel')}</Text>
          </View>
          <View style={styles.trustPill}>
            <Feather name="shield" size={13} color={colors.primary} />
            <Text style={styles.trustText}>{t('subscription.trust.secure')}</Text>
          </View>
          <View style={styles.trustPill}>
            <Feather name="unlock" size={13} color={colors.primary} />
            <Text style={styles.trustText}>{t('subscription.trust.commitment')}</Text>
          </View>
        </View>

        {/* ── FAQ ── */}
        <Text style={styles.faqTitle}>{t('subscription.faq.title')}</Text>
        <View style={styles.faqList}>
          {FAQ_ITEMS.map((n, i) => {
            const opened = openedFaq === i;
            return (
              <View key={n} style={styles.faqItem}>
                <Pressable onPress={() => handleFaqToggle(i)} style={styles.faqQRow}>
                  <Text style={styles.faqQ}>{t(`subscription.faq.q${n}`)}</Text>
                  <Feather
                    name={opened ? 'minus' : 'plus'}
                    size={18}
                    color={opened ? colors.primary : colors.textMuted}
                  />
                </Pressable>
                {opened && (
                  <Text style={styles.faqA}>{t(`subscription.faq.a${n}`)}</Text>
                )}
              </View>
            );
          })}
        </View>

        <View style={{ height: 180 }} />
      </ScrollView>

      {/* ── STICKY BOTTOM ── */}
      <View style={styles.stickyBottom}>
        <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
          <TouchableOpacity
            onPress={handlePurchase}
            disabled={purchasing || !user}
            activeOpacity={0.88}
            style={styles.ctaTouch}
          >
            <SafeGradient
              colors={purchasing ? [colors.surface, colors.surface] : ['#A4FF6B', '#00FF8C', colors.primary, '#00C96A']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ctaGradient}
            >
              {purchasing ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <Text style={styles.ctaText}>{ctaLabel}</Text>
                  <Feather name="arrow-right" size={18} color="#062318" />
                </>
              )}
            </SafeGradient>
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.ctaHint}>{ctaHint}</Text>

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

const COL_FREE = 88;
const COL_PLUS = 100;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  closeBtn: {
    position: 'absolute', top: 54, right: 20, zIndex: 20,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.07)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },

  scroll: { paddingBottom: 20 },

  // Hero
  hero: { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 24, overflow: 'hidden' },
  heroGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 380 },
  heroOrb: {
    position: 'absolute',
    top: -120,
    left: '20%',
    width: 280,
    height: 280,
    borderRadius: 140,
    opacity: 0.6,
  },
  crownRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  crownBadge: {
    width: 38, height: 38, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#00FF8C', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.8, shadowRadius: 14, elevation: 12,
  },
  crownLabel: { color: '#00FF8C', fontSize: 11, fontWeight: '900', letterSpacing: 2.5 },
  heroTitle: { color: colors.textMain, fontSize: 40, fontWeight: '900', lineHeight: 44, letterSpacing: -1.4, marginBottom: 14 },
  heroSub: { color: 'rgba(255,255,255,0.7)', fontSize: 15, lineHeight: 22 },

  // Value props (2x2 grid)
  valueGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 18,
  },
  valueCard: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.08)',
  },
  valueIconWrap: {
    width: 34, height: 34, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 10,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 6, elevation: 5,
  },
  valueTitle: { color: colors.textMain, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  valueSub: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },

  // Toggle
  toggleWrap: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  toggleBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  toggleBtnActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  toggleText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  toggleTextActive: { color: colors.textMain },
  savingsBadge: {
    backgroundColor: '#A4FF6B',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 7,
    shadowColor: '#A4FF6B', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.6, shadowRadius: 6, elevation: 4,
  },
  savingsBadgeText: { color: '#0A2010', fontSize: 11, fontWeight: '900', letterSpacing: 0.3 },

  // Pricing card
  priceCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    paddingHorizontal: 22, paddingTop: 20, paddingBottom: 18,
    marginBottom: 18,
    borderWidth: 1.5, borderColor: 'rgba(0,255,140,0.3)',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 6,
  },
  trialBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, marginBottom: 14,
    shadowColor: '#00FF8C', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.6, shadowRadius: 8, elevation: 6,
  },
  trialBadgeText: { color: '#062318', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  priceMain: { color: colors.textMain, fontSize: 42, fontWeight: '900', letterSpacing: -1.4 },
  priceSuffix: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  priceSub: { color: colors.textDimmed, fontSize: 12, marginTop: 5, fontWeight: '500' },

  // Table
  tableContainer: {
    marginHorizontal: 16, borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 18,
  },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  headerLabel: { flex: 1 },
  headerFree: {
    width: COL_FREE, paddingVertical: 14, alignItems: 'center',
    borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  headerFreeTitle: { color: colors.textDimmed, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  headerPlus: {
    width: COL_PLUS, paddingVertical: 14, alignItems: 'center',
    borderLeftWidth: 1, borderLeftColor: 'rgba(0,230,118,0.18)',
  },
  headerPlusCrown: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center', marginBottom: 3,
  },
  headerPlusTitle: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, backgroundColor: colors.surface },
  tableRowShade: { backgroundColor: '#12201A' },
  rowLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingLeft: 14, paddingRight: 8 },
  rowIcon: { marginRight: 9 },
  rowLabelText: { color: colors.textMain, fontSize: 13, fontWeight: '500', flex: 1 },
  cell: {
    width: COL_FREE, alignItems: 'center', justifyContent: 'center', paddingVertical: 12,
    borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.015)',
  },
  cellPlus: {
    width: COL_PLUS, backgroundColor: 'rgba(0,230,118,0.055)',
    borderLeftColor: 'rgba(0,230,118,0.12)',
  },
  lockWrap: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    justifyContent: 'center', alignItems: 'center',
  },
  cellFreeText: { color: colors.textDimmed, fontSize: 11, fontWeight: '600', textAlign: 'center', paddingHorizontal: 4 },
  cellPlusText: { color: colors.primary, fontSize: 11, fontWeight: '700', textAlign: 'center', paddingHorizontal: 4 },

  // Trust signals - pills colorées
  trustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 28,
  },
  trustPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,230,118,0.10)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.22)',
  },
  trustText: { color: colors.textMain, fontSize: 11, fontWeight: '700' },

  // FAQ
  faqTitle: {
    color: colors.textMain,
    fontSize: 18,
    fontWeight: '900',
    marginHorizontal: 20,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  faqList: { marginHorizontal: 16, gap: 8 },
  faqItem: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  faqQRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  faqQ: { color: colors.textMain, fontSize: 14, fontWeight: '700', flex: 1, lineHeight: 20 },
  faqA: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },

  // Sticky bottom
  stickyBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingBottom: 24, paddingTop: 14,
    backgroundColor: colors.background,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  ctaTouch: {
    borderRadius: 18, overflow: 'hidden', marginBottom: 10,
    shadowColor: '#00FF8C', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.55, shadowRadius: 22, elevation: 14,
  },
  ctaGradient: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: 10, paddingVertical: 20,
  },
  ctaText: { color: '#062318', fontSize: 17, fontWeight: '900', letterSpacing: 0.3 },
  ctaHint: { color: colors.textDimmed, fontSize: 11, textAlign: 'center', marginBottom: 12, lineHeight: 16 },

  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  footerLink: { color: 'rgba(255,255,255,0.28)', fontSize: 11 },
  footerSep: { color: 'rgba(255,255,255,0.18)', fontSize: 11 },
});

export default SubscriptionScreen;
