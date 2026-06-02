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
  Linking,
  Dimensions,
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
import { getEffectivePlanTier } from '../services/subscriptionService';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_W } = Dimensions.get('window');

type Cycle = 'monthly' | 'yearly';

const FEATURES = [
  { icon: 'zap',         colorKey: 'subscription.feat.scan',      textKey: 'subscription.feat.scanText' },
  { icon: 'trending-up', colorKey: 'subscription.feat.hourly',    textKey: 'subscription.feat.hourlyText' },
  { icon: 'x-octagon',   colorKey: 'subscription.feat.filter',    textKey: 'subscription.feat.filterText' },
  { icon: 'target',      colorKey: 'subscription.feat.threshold', textKey: 'subscription.feat.thresholdText' },
] as const;

const FAQ_ITEMS = [1, 2, 3, 4] as const;

// Floating orb positions for hero background
const ORBS = [
  { size: 6,  top: 24,  left: '12%' },
  { size: 8,  top: 60,  left: '82%' },
  { size: 5,  top: 95,  left: '25%' },
  { size: 10, top: 40,  left: '68%' },
  { size: 4,  top: 110, left: '90%' },
  { size: 7,  top: 15,  left: '50%' },
  { size: 5,  top: 80,  left: '5%'  },
];

const SubscriptionScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const { toast, showToast, dismissToast } = useToast();

  const tier = getEffectivePlanTier(profile);
  const isPlus = tier !== 'free';

  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [monthly, setMonthly] = useState<PlusPackage | null>(null);
  const [yearly, setYearly] = useState<PlusPackage | null>(null);
  const [trialEligible, setTrialEligible] = useState(false);
  const [openedFaq, setOpenedFaq] = useState<number | null>(null);

  // Hero orb float animation
  const orbAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(orbAnim, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(orbAnim, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ).start();
  }, [orbAnim]);

  const orbTranslateY = orbAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });

  // CTA pulse
  const ctaScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (purchasing || isPlus) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaScale, { toValue: 1.035, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(ctaScale, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ctaScale, purchasing, isPlus]);

  // Crown glow pulse
  const glowAnim = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.6, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ).start();
  }, [glowAnim]);

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

  const activeProductId = cycle === 'yearly' ? IAP_PRODUCTS.PLUS_YEARLY : IAP_PRODUCTS.PLUS_MONTHLY;
  const activePkg = cycle === 'yearly' ? yearly : monthly;

  const mainPriceText =
    activePkg?.priceString ??
    (cycle === 'yearly' ? t('subscription.yearlyFallbackPrice') : t('subscription.monthlyFallbackPrice'));

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

  const handleManage = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('https://apps.apple.com/account/subscriptions');
    } else {
      Linking.openURL('https://play.google.com/store/account/subscriptions');
    }
  };

  const storeLabel = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

  const ctaLabel = trialEligible ? t('subscription.ctaTrial') : t('subscription.ctaSubscribe');
  const ctaHint = trialEligible
    ? t('subscription.ctaHintTrial', { price: mainPriceText, cycle: cycle === 'yearly' ? t('subscription.cycleYearly') : t('subscription.cycleMonthly') })
    : t('subscription.ctaHintNoTrial', { cycle: cycle === 'yearly' ? t('subscription.cycleYearly') : t('subscription.cycleMonthly') });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />

      <TouchableOpacity
        onPress={() => navigation.canGoBack() && navigation.goBack()}
        style={styles.closeBtn}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Feather name="x" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── HERO ── */}
        <View style={styles.hero}>
          {/* Radial glow */}
          <SafeGradient
            colors={['rgba(0,230,118,0.22)', 'rgba(0,230,118,0.06)', 'transparent']}
            style={styles.heroGlow}
            pointerEvents="none"
          />
          {/* Secondary warm glow */}
          <View style={styles.heroWarmGlow} pointerEvents="none" />

          {/* Floating orbs */}
          <Animated.View style={[styles.orbContainer, { transform: [{ translateY: orbTranslateY }] }]} pointerEvents="none">
            {ORBS.map((o, i) => (
              <View
                key={i}
                style={[styles.orb, {
                  width: o.size, height: o.size, borderRadius: o.size / 2,
                  top: o.top, left: o.left as any,
                  opacity: 0.25 + (i % 3) * 0.15,
                }]}
              />
            ))}
          </Animated.View>

          {/* Crown icon with animated glow ring */}
          <View style={styles.crownRow}>
            <View style={styles.crownOuter}>
              <Animated.View style={[styles.crownGlowRing, { opacity: glowAnim }]} />
              <SafeGradient colors={['#00FF8C', '#00E676', '#00B85A']} style={styles.crownBadge}>
                <MaterialCommunityIcons name="crown" size={26} color="#000" />
              </SafeGradient>
            </View>
          </View>

          <Text style={styles.labelText}>STRIVE PLUS</Text>
          <Text style={styles.heroTitle}>
            {isPlus ? t('subscription.heroTitleActive') : t('subscription.heroTitle')}
          </Text>
          <Text style={styles.heroSub}>
            {isPlus ? t('subscription.heroSubActive') : t('subscription.heroSub')}
          </Text>
        </View>

        {/* ── FEATURES ── */}
        <View style={styles.featureList}>
          {FEATURES.map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <SafeGradient
                colors={['rgba(0,230,118,0.2)', 'rgba(0,230,118,0.08)']}
                style={styles.featureIconWrap}
              >
                <Feather name={f.icon as any} size={16} color={colors.primary} />
              </SafeGradient>
              <Text style={styles.featureText}>
                <Text style={styles.featureHighlight}>{t(f.colorKey)}</Text>
                {'  '}{t(f.textKey)}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Divider ── */}
        <View style={styles.divider} />

        {isPlus ? (
          /* ── ACTIVE SUBSCRIBER ── */
          <View style={styles.activeCard}>
            <SafeGradient
              colors={['rgba(0,230,118,0.12)', 'rgba(0,230,118,0.03)']}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.activeCardHeader}>
              <View style={styles.activeCheckWrap}>
                <MaterialCommunityIcons name="check-bold" size={14} color="#000" />
              </View>
              <Text style={styles.activeCardTitle}>{t('subscription.activeTitle')}</Text>
            </View>
            <Text style={styles.activeCardSub}>{t('subscription.activeSub')}</Text>

            <TouchableOpacity style={styles.manageBtn} onPress={handleManage} activeOpacity={0.8}>
              <Feather name="external-link" size={15} color={colors.textMain} />
              <Text style={styles.manageBtnText}>
                {t('subscription.manageVia', { store: storeLabel })}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelHint}
              onPress={handleManage}
              activeOpacity={0.7}
            >
              <Feather name="info" size={13} color={colors.textDimmed} />
              <Text style={styles.cancelHintText}>
                {t('subscription.cancelHint', { store: storeLabel })}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ── PLAN CARDS ── */}

            {/* Monthly — hero card */}
            <Pressable
              onPress={() => { hapticLight(); setCycle('monthly'); }}
              style={[styles.planCard, styles.planCardMonthly, cycle === 'monthly' && styles.planCardMonthlySelected]}
            >
              <SafeGradient
                colors={cycle === 'monthly'
                  ? ['rgba(0,230,118,0.14)', 'rgba(0,230,118,0.04)']
                  : ['rgba(0,230,118,0.06)', 'rgba(0,230,118,0.01)']}
                style={StyleSheet.absoluteFillObject}
              />
              {/* Ribbon badge */}
              <View style={styles.popularBadge}>
                <SafeGradient colors={['#A4FF6B', '#00FF8C', colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.popularBadgeInner}>
                  <MaterialCommunityIcons name={trialEligible ? 'gift-outline' : 'star-four-points'} size={10} color="#062318" />
                  <Text style={styles.popularBadgeText}>
                    {trialEligible ? t('subscription.trialRibbon', '7 JOURS GRATUITS') : t('subscription.popular')}
                  </Text>
                </SafeGradient>
              </View>
              <View style={styles.planCardLeft}>
                <View style={cycle === 'monthly' ? styles.radioSelected : styles.radio}>
                  {cycle === 'monthly' && <View style={styles.radioInner} />}
                </View>
              </View>
              <View style={styles.planCardContent}>
                <Text style={[styles.planCardTitle, styles.planCardTitleMonthly]}>
                  {t('subscription.monthlyAccess')}
                </Text>
                {trialEligible ? (
                  <>
                    <Text style={styles.trialFreeLabel}>{t('subscription.trialFreeLabel', '0,00 € pendant 7 jours')}</Text>
                    <Text style={styles.trialThenPrice}>
                      {t('subscription.trialThenPrice', 'puis {{price}}/mois', { price: monthly?.priceString ?? t('subscription.monthlyFallbackPrice') })}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.planCardPrice, styles.planCardPriceMonthly]}>
                      {monthly?.priceString ?? t('subscription.monthlyFallbackPrice')}
                      <Text style={styles.planCardPriceSuffix}> {t('subscription.perMonthShort')}</Text>
                    </Text>
                  </>
                )}
                <Text style={styles.monthlySubHint}>
                  {trialEligible
                    ? t('subscription.trialHint', 'Annulable à tout moment pendant l\'essai')
                    : t('subscription.monthlyHint')}
                </Text>
              </View>
            </Pressable>

            {/* Yearly — secondary */}
            <Pressable
              onPress={() => { hapticLight(); setCycle('yearly'); }}
              style={[styles.planCard, cycle === 'yearly' && styles.planCardSelected]}
            >
              {cycle === 'yearly' && (
                <SafeGradient
                  colors={['rgba(0,230,118,0.08)', 'rgba(0,230,118,0.02)']}
                  style={StyleSheet.absoluteFillObject}
                />
              )}
              <View style={styles.planCardLeft}>
                <View style={cycle === 'yearly' ? styles.radioSelected : styles.radio}>
                  {cycle === 'yearly' && <View style={styles.radioInner} />}
                </View>
              </View>
              <View style={styles.planCardContent}>
                <View style={styles.planCardTitleRow}>
                  <Text style={[styles.planCardTitle, cycle === 'yearly' && styles.planCardTitleActive]}>
                    {t('subscription.yearlyAccess')}
                  </Text>
                  <View style={styles.bestBadge}>
                    <Text style={styles.bestBadgeText}>-{savingsPct}%</Text>
                  </View>
                </View>
                <Text style={styles.planCardPrice}>
                  {yearly?.priceString ?? t('subscription.yearlyFallbackPrice')}
                  <Text style={styles.planCardPriceSuffix}> {t('subscription.perYearShort')}</Text>
                </Text>
                {yearly?.pricePerMonthString && (
                  <Text style={styles.planCardEquiv}>
                    {t('subscription.perMonthEquiv', { price: yearly.pricePerMonthString })}
                  </Text>
                )}
              </View>
            </Pressable>

            {/* ── TRUST ── */}
            <View style={styles.trustRow}>
              <View style={styles.trustPill}>
                <Feather name="refresh-cw" size={12} color={colors.primary} />
                <Text style={styles.trustText}>{t('subscription.trust.cancel')}</Text>
              </View>
              <View style={styles.trustPill}>
                <Feather name="shield" size={12} color={colors.primary} />
                <Text style={styles.trustText}>
                  {Platform.OS === 'ios' ? t('subscription.trust.secure') : t('subscription.trust.secureAndroid', 'Google Play')}
                </Text>
              </View>
              <View style={styles.trustPill}>
                <Feather name="unlock" size={12} color={colors.primary} />
                <Text style={styles.trustText}>{t('subscription.trust.commitment')}</Text>
              </View>
            </View>
          </>
        )}

        {/* ── FAQ ── */}
        <View style={styles.divider} />
        <Text style={styles.faqTitle}>{t('subscription.faq.title')}</Text>
        <View style={styles.faqList}>
          {FAQ_ITEMS.map((n, i) => {
            const opened = openedFaq === i;
            return (
              <View key={n} style={[styles.faqItem, opened && styles.faqItemOpened]}>
                <Pressable onPress={() => handleFaqToggle(i)} style={styles.faqQRow}>
                  <Text style={styles.faqQ}>{t(`subscription.faq.q${n}`)}</Text>
                  <View style={[styles.faqToggle, opened && styles.faqToggleOpen]}>
                    <Feather name={opened ? 'minus' : 'plus'} size={14} color={opened ? '#000' : colors.textMuted} />
                  </View>
                </Pressable>
                {opened && (
                  <Text style={styles.faqA}>{t(`subscription.faq.a${n}`)}</Text>
                )}
              </View>
            );
          })}
        </View>

        <View style={{ height: isPlus ? 40 : 190 }} />
      </ScrollView>

      {/* ── STICKY BOTTOM ── */}
      {!isPlus && (
        <SafeGradient
          colors={[`${colors.background}00`, colors.background, colors.background]}
          style={styles.stickyBottom}
          pointerEvents="box-none"
        >
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
                : <Text style={styles.footerLinkUnderline}>{t('subscription.restore')}</Text>
              }
            </TouchableOpacity>
            <Text style={styles.footerSep}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://strive.app/terms')}>
              <Text style={styles.footerLink}>{t('subscription.terms')}</Text>
            </TouchableOpacity>
            <Text style={styles.footerSep}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://strive.app/privacy')}>
              <Text style={styles.footerLink}>{t('subscription.privacy')}</Text>
            </TouchableOpacity>
          </View>
        </SafeGradient>
      )}

      <Toast data={toast} onDismiss={dismissToast} bottomOffset={40} />
    </SafeAreaView>
  );
};

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

  // ── Hero ──
  hero: {
    paddingHorizontal: 24, paddingTop: 60, paddingBottom: 32,
    overflow: 'hidden', alignItems: 'center',
  },
  heroGlow: {
    position: 'absolute', top: -60, left: -40, right: -40, height: 420,
    borderRadius: 200,
  },
  heroWarmGlow: {
    position: 'absolute', top: -20, left: SCREEN_W * 0.15,
    width: SCREEN_W * 0.7, height: SCREEN_W * 0.7,
    borderRadius: SCREEN_W * 0.35,
    backgroundColor: 'rgba(0,255,140,0.04)',
  },
  orbContainer: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  orb: { position: 'absolute', backgroundColor: colors.primary },

  crownRow: { marginBottom: 18 },
  crownOuter: { alignItems: 'center', justifyContent: 'center' },
  crownGlowRing: {
    position: 'absolute',
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'transparent',
    borderWidth: 2, borderColor: 'rgba(0,255,140,0.3)',
  },
  crownBadge: {
    width: 60, height: 60, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#00FF8C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.8, shadowRadius: 24,
    elevation: 16,
  },

  labelText: {
    color: colors.primary, fontSize: 11, fontWeight: '900',
    letterSpacing: 3, marginBottom: 10,
  },
  heroTitle: {
    color: colors.textMain, fontSize: 30, fontWeight: '900',
    lineHeight: 36, letterSpacing: -0.8, marginBottom: 10, textAlign: 'center',
  },
  heroSub: {
    color: 'rgba(255,255,255,0.55)', fontSize: 15,
    lineHeight: 22, textAlign: 'center', maxWidth: 300,
  },

  // ── Features ──
  featureList: { marginHorizontal: 20, marginBottom: 24, gap: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIconWrap: {
    width: 36, height: 36, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  featureText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '500', flex: 1, lineHeight: 20 },
  featureHighlight: { color: colors.primary, fontWeight: '800' },

  divider: {
    height: 1, marginHorizontal: 32, marginBottom: 22,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  // ── Plan cards ──
  planCard: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: colors.surface,
    borderRadius: 18, paddingVertical: 18, paddingHorizontal: 16,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row', alignItems: 'center',
    overflow: 'hidden',
  },
  planCardMonthly: {
    borderWidth: 2, borderColor: 'rgba(0,230,118,0.25)',
    paddingTop: 28,
  },
  planCardMonthlySelected: {
    borderColor: colors.primary,
    ...Platform.select({
      ios: { shadowColor: '#00E676', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16 },
      android: { elevation: 10 },
    }),
  },
  planCardSelected: {
    borderColor: colors.primary,
    ...Platform.select({
      ios: { shadowColor: '#00E676', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12 },
      android: { elevation: 6 },
    }),
  },
  planCardLeft: { marginRight: 14 },
  planCardContent: { flex: 1 },
  planCardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  planCardTitle: { color: colors.textDimmed, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  planCardTitleMonthly: { color: colors.primary },
  planCardTitleActive: { color: colors.textMuted },
  planCardPrice: { color: colors.textMain, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  planCardPriceMonthly: { fontSize: 30 },
  planCardPriceSuffix: { color: colors.textDimmed, fontSize: 13, fontWeight: '600' },
  planCardEquiv: { color: colors.textDimmed, fontSize: 12, marginTop: 2, fontWeight: '500' },
  monthlySubHint: { color: colors.textMuted, fontSize: 12, marginTop: 4, fontWeight: '500' },
  trialFreeLabel: { color: colors.primary, fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  trialThenPrice: { color: colors.textDimmed, fontSize: 13, fontWeight: '600', marginTop: 2 },
  popularBadge: { position: 'absolute', top: -1, right: 16, zIndex: 1 },
  popularBadgeInner: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
  },
  popularBadgeText: { color: '#062318', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },

  radio: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)',
  },
  radioSelected: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  radioInner: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.primary,
  },

  bestBadge: {
    backgroundColor: '#A4FF6B', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6,
  },
  bestBadgeText: { color: '#0A2010', fontSize: 10, fontWeight: '900', letterSpacing: 0.3 },
  trialPill: {
    backgroundColor: 'rgba(0,230,118,0.15)', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,230,118,0.3)',
  },
  trialPillText: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  // ── Active subscriber ──
  activeCard: {
    marginHorizontal: 16, marginBottom: 22,
    borderRadius: 20, padding: 22,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.2)',
    overflow: 'hidden',
  },
  activeCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  activeCheckWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  activeCardTitle: { color: colors.textMain, fontSize: 17, fontWeight: '800' },
  activeCardSub: { color: colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 18 },
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 18, paddingVertical: 14,
    borderRadius: 14, alignSelf: 'stretch',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
  },
  manageBtnText: { color: colors.textMain, fontSize: 14, fontWeight: '700' },
  cancelHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 14, alignSelf: 'center',
  },
  cancelHintText: { color: colors.textDimmed, fontSize: 12 },

  // ── Trust ──
  trustRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', gap: 8,
    paddingHorizontal: 16, marginTop: 8, marginBottom: 28,
  },
  trustPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,230,118,0.08)',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: 'rgba(0,230,118,0.15)',
  },
  trustText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },

  // ── FAQ ──
  faqTitle: {
    color: colors.textMain, fontSize: 18, fontWeight: '900',
    marginHorizontal: 20, marginBottom: 14, letterSpacing: -0.3,
  },
  faqList: { marginHorizontal: 16, gap: 8 },
  faqItem: {
    backgroundColor: colors.surface, borderRadius: 14,
    paddingHorizontal: 18, paddingVertical: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)',
  },
  faqItemOpened: { borderColor: 'rgba(0,230,118,0.15)' },
  faqQRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  faqQ: { color: colors.textMain, fontSize: 14, fontWeight: '700', flex: 1, lineHeight: 20 },
  faqToggle: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center', alignItems: 'center',
  },
  faqToggleOpen: { backgroundColor: colors.primary },
  faqA: {
    color: colors.textMuted, fontSize: 13, lineHeight: 20,
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)',
  },

  // ── Sticky bottom ──
  stickyBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingBottom: 28, paddingTop: 24,
  },
  ctaTouch: {
    borderRadius: 18, overflow: 'hidden', marginBottom: 10,
    ...Platform.select({
      ios: { shadowColor: '#00FF8C', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.55, shadowRadius: 22 },
      android: { elevation: 14 },
    }),
  },
  ctaGradient: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: 10, paddingVertical: 20,
  },
  ctaText: { color: '#062318', fontSize: 17, fontWeight: '900', letterSpacing: 0.3 },
  ctaHint: { color: colors.textDimmed, fontSize: 11, textAlign: 'center', marginBottom: 12, lineHeight: 16 },

  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  footerLink: { color: 'rgba(255,255,255,0.25)', fontSize: 11 },
  footerLinkUnderline: { color: 'rgba(255,255,255,0.35)', fontSize: 11, textDecorationLine: 'underline' },
  footerSep: { color: 'rgba(255,255,255,0.15)', fontSize: 11 },
});

export default SubscriptionScreen;
