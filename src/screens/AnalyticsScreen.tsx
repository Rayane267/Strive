import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import SafeGradient from '../components/SafeGradient';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';
import { getEffectivePlanTier, getPlanLimits } from '../services/subscriptionService';
import { effectiveFare } from '../services/ridesService';
import { useNavigation } from '@react-navigation/native';
import { getDayStart } from '../utils/dateUtils';
import EarningsChart from '../components/EarningsChart';
import KpiTrendChart from '../components/KpiTrendChart';
import AnimatedEntrance from '../components/AnimatedEntrance';
import BrandLoader from '../components/BrandLoader';
import { cacheStats, getCachedStats } from '../services/offlineService';

LocaleConfig.locales['fr'] = {
  monthNames: ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'],
  monthNamesShort: ['Janv.','Févr.','Mars','Avr.','Mai','Juin','Juil.','Août','Sept.','Oct.','Nov.','Déc.'],
  dayNames: ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'],
  dayNamesShort: ['Di','Lu','Ma','Me','Je','Ve','Sa'],
  today: "Aujourd'hui",
};
LocaleConfig.locales['en'] = {
  monthNames: ['January','February','March','April','May','June','July','August','September','October','November','December'],
  monthNamesShort: ['Jan.','Feb.','Mar.','Apr.','May','Jun.','Jul.','Aug.','Sep.','Oct.','Nov.','Dec.'],
  dayNames: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
  dayNamesShort: ['Su','Mo','Tu','We','Th','Fr','Sa'],
  today: 'Today',
};

const PLATFORMS = [
  { key: 'UBER',   label: 'Uber',   color: '#FFFFFF' },
  { key: 'BOLT',   label: 'Bolt',   color: '#34BB78' },
  { key: 'HEETCH', label: 'Heetch', color: '#FF3B80' },
] as const;

const AnalyticsScreen = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<any>();

  const [resetHour, setResetHour] = useState(0);

  useEffect(() => {
    LocaleConfig.defaultLocale = i18n.language === 'fr' ? 'fr' : 'en';
  }, [i18n.language]);

  // Fetch day_reset_hour preference
  useEffect(() => {
    if (!user) return;
    supabase
      .from('preferences')
      .select('day_reset_hour')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        const h = data?.day_reset_hour === 4 ? 4 : 0;
        setResetHour(h);
        setDateRange({ start: getDayStart(h), end: getDayStart(h) });
      });
  }, [user]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [dateRange, setDateRange] = useState({ start: new Date(), end: new Date() });
  const [modalVisible, setModalVisible] = useState(false);
  const [selectionStep, setSelectionStep] = useState(0);
  const [tempStart, setTempStart] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().split('T')[0]);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [modalAlert, setModalAlert] = useState('');

  const [stats, setStats] = useState({
    totalProfit: 0,
    totalDistance: 0,
    totalDurationMin: 0,
    hourlyRate: 0,
    pricePerKm: 0,
    acceptedCount: 0,
    fuelCost: 0,
    appDistribution: { UBER: 0, BOLT: 0, HEETCH: 0 },
    appEarnings: { UBER: 0, BOLT: 0, HEETCH: 0 },
  });

  const [showNet, setShowNet] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;
  const hasFuelData = stats.fuelCost > 0;

  const toggleProfitView = () => {
    if (!hasFuelData) return;
    const toNet = !showNet;
    setShowNet(toNet);
    Animated.spring(flipAnim, { toValue: toNet ? 1 : 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
  };

  const [dailyEarnings, setDailyEarnings] = useState<{ label: string; earnings: number; isToday?: boolean }[]>([]);
  const [hourlyTrend, setHourlyTrend] = useState<{ label: string; value: number }[]>([]);
  const [kmTrend, setKmTrend] = useState<{ label: string; value: number }[]>([]);

  const fetchingRef = useRef(false);
  const fetchAnalytics = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setFetchError(false);
    try {
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('subscription_tier, subscription_expires_at, avg_cons, fuel_type, fuel_price')
        .eq('id', user.id)
        .single();

      const planTier = getEffectivePlanTier(profileData);
      getPlanLimits(planTier);
      const canAccessHistory = planTier !== 'free';
      setIsPremium(canAccessHistory);

      let rangeStart = canAccessHistory && dateRange?.start ? new Date(dateRange.start) : getDayStart(resetHour);
      rangeStart.setHours(resetHour, 0, 0, 0);

      let rangeEnd = canAccessHistory && dateRange?.end ? new Date(dateRange.end) : new Date(rangeStart);
      rangeEnd.setDate(rangeEnd.getDate() + 1);
      rangeEnd.setHours(resetHour, 0, 0, 0);

      // Parallélise rides + sessions (round-trips indépendants → -1 RTT)
      const [
        { data: rides, error: ridesError },
        { data: sessionsData, error: sessionsError },
      ] = await Promise.all([
        supabase
          .from('rides')
          .select('*')
          .eq('user_id', user.id)
          .gte('created_at', rangeStart.toISOString())
          .lt('created_at', rangeEnd.toISOString()),
        supabase
          .from('online_sessions')
          .select('duration_seconds, start_at, end_at')
          .eq('user_id', user.id)
          .gte('start_at', rangeStart.toISOString())
          .lt('start_at', rangeEnd.toISOString()),
      ]);

      if (ridesError) throw ridesError;
      if (sessionsError) throw sessionsError;

      if (!rides || rides.length === 0) {
        const emptyStats = { totalProfit: 0, totalDistance: 0, totalDurationMin: 0, hourlyRate: 0, pricePerKm: 0, acceptedCount: 0, appDistribution: { UBER: 0, BOLT: 0, HEETCH: 0 }, appEarnings: { UBER: 0, BOLT: 0, HEETCH: 0 } };
        setStats(emptyStats);
        setDailyEarnings([]);
        setHourlyTrend([]);
        setKmTrend([]);
        return;
      }

      const acceptedRides = rides.filter((r: any) => r.status === 'ACCEPTED');
      let totalProfit = 0;
      let totalDistance = 0;
      const distribution: Record<'UBER' | 'BOLT' | 'HEETCH', number> = { UBER: 0, BOLT: 0, HEETCH: 0 };

      acceptedRides.forEach((ride: any) => {
        const fare = effectiveFare(ride);
        totalProfit += fare;
        totalDistance += Number(ride.distance_km || 0);
        const platform = (ride.platform as 'UBER' | 'BOLT' | 'HEETCH') || 'UBER';
        if (distribution[platform] !== undefined) distribution[platform] += fare;
      });

      const totalOnlineSeconds = sessionsData?.reduce((sum: number, session: any) => {
        if (session.end_at && session.duration_seconds) return sum + session.duration_seconds;
        if (!session.end_at) {
          const diff = Math.floor((Date.now() - new Date(session.start_at).getTime()) / 1000);
          if (diff < 43200) return sum + diff;
        }
        return sum;
      }, 0) || 0;

      // ── Daily breakdown for charts ──
      const dayLabels = i18n.language === 'fr'
        ? ['Di','Lu','Ma','Me','Je','Ve','Sa']
        : ['Su','Mo','Tu','We','Th','Fr','Sa'];
      const todayStr = new Date().toISOString().split('T')[0];

      const dailyMap = new Map<string, { earnings: number; distance: number; hours: number }>();
      acceptedRides.forEach((ride: any) => {
        const dateKey = new Date(ride.created_at).toISOString().split('T')[0];
        const existing = dailyMap.get(dateKey) || { earnings: 0, distance: 0, hours: 0 };
        const fare = effectiveFare(ride);
        existing.earnings += fare;
        existing.distance += Number(ride.distance_km || 0);
        existing.hours += Number(ride.duration_min || 0) / 60;
        dailyMap.set(dateKey, existing);
      });

      // Build chart data for the date range
      const chartDays: { label: string; earnings: number; isToday?: boolean }[] = [];
      const hrTrend: { label: string; value: number }[] = [];
      const kmTrendData: { label: string; value: number }[] = [];
      const cursor = new Date(rangeStart);
      while (cursor < rangeEnd) {
        const key = cursor.toISOString().split('T')[0];
        const dayData = dailyMap.get(key);
        const dayOfWeek = cursor.getDay();
        const label = dayLabels[dayOfWeek];
        chartDays.push({
          label,
          earnings: dayData?.earnings || 0,
          isToday: key === todayStr,
        });
        if (dayData && dayData.earnings > 0) {
          const hr = dayData.hours > 0 ? dayData.earnings / dayData.hours : 0;
          const km = dayData.distance > 0 ? dayData.earnings / dayData.distance : 0;
          hrTrend.push({ label, value: hr });
          kmTrendData.push({ label, value: km });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      setDailyEarnings(chartDays);
      setHourlyTrend(hrTrend);
      setKmTrend(kmTrendData);

      const totalOnlineHours = totalOnlineSeconds / 3600;

      const avgCons = profileData?.avg_cons ?? 0;
      const fuelPrice = profileData?.fuel_price ?? 0;
      const fuelCost = (avgCons > 0 && fuelPrice > 0) ? (totalDistance / 100) * avgCons * fuelPrice : 0;

      const newStats = {
        totalProfit,
        totalDistance,
        totalDurationMin: Math.floor(totalOnlineSeconds / 60),
        hourlyRate: totalOnlineHours > 0 ? totalProfit / totalOnlineHours : 0,
        pricePerKm: totalDistance > 0 ? totalProfit / totalDistance : 0,
        acceptedCount: acceptedRides.length,
        fuelCost,
        appDistribution: {
          UBER:   totalProfit > 0 ? Math.round((distribution.UBER   / totalProfit) * 100) : 0,
          BOLT:   totalProfit > 0 ? Math.round((distribution.BOLT   / totalProfit) * 100) : 0,
          HEETCH: totalProfit > 0 ? Math.round((distribution.HEETCH / totalProfit) * 100) : 0,
        },
        appEarnings: {
          UBER:   distribution.UBER,
          BOLT:   distribution.BOLT,
          HEETCH: distribution.HEETCH,
        },
      };
      setStats(newStats);
      cacheStats(newStats);
    } catch (e) {
      __DEV__ && console.error(e);
      setFetchError(true);
      // Fallback to cached stats when offline
      const cached = await getCachedStats();
      if (cached) setStats(cached);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [user, dateRange, resetHour]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAnalytics();
    setRefreshing(false);
  }, [fetchAnalytics]);

  useFocusEffect(useCallback(() => { fetchAnalytics(); }, [fetchAnalytics]));

  const handleDayPress = (day: any) => {
    const todayString = new Date().toISOString().split('T')[0];
    if (!isPremium && day.dateString !== todayString) {
      setModalAlert(t('analytics.alerts.premiumRequired'));
      return;
    }
    setModalAlert('');
    if (selectionStep === 0) {
      setTempStart(day.dateString);
      setSelectionStep(1);
    } else {
      const start = new Date(tempStart!);
      const end = new Date(day.dateString);
      if (end < start) { setTempStart(day.dateString); return; }
      const diffDays = Math.ceil(Math.abs(end.getTime() - start.getTime()) / 86400000);
      if (diffDays > 6) {
        setModalAlert(t('analytics.alerts.limitText', 'Max 7 jours.'));
        setTempStart(day.dateString);
        return;
      }
      setDateRange({ start: new Date(tempStart!), end: new Date(day.dateString) });
      setSelectionStep(0);
      setModalVisible(false);
    }
  };

  const getMarkedDates = () => {
    const marks: any = {};
    const edge = colors.primary;
    const edgeText = '#06140C';
    const mid = 'rgba(0,230,118,0.20)';
    const midText = colors.textMain;
    if (selectionStep === 1 && tempStart) {
      marks[tempStart] = { startingDay: true, endingDay: true, color: edge, textColor: edgeText };
    } else if (dateRange.start && dateRange.end) {
      const startStr = dateRange.start.toISOString().split('T')[0];
      const endStr = dateRange.end.toISOString().split('T')[0];
      if (startStr === endStr) {
        marks[startStr] = { startingDay: true, endingDay: true, color: edge, textColor: edgeText };
      } else {
        let curr = new Date(startStr);
        while (curr <= new Date(endStr)) {
          const ds = curr.toISOString().split('T')[0];
          if (ds === startStr)      marks[ds] = { startingDay: true, color: edge, textColor: edgeText };
          else if (ds === endStr)   marks[ds] = { endingDay: true,   color: edge, textColor: edgeText };
          else                      marks[ds] = { color: mid, textColor: midText };
          curr.setDate(curr.getDate() + 1);
        }
      }
    }
    return marks;
  };

  const changeMonth = (offset: number) => {
    const d = new Date(currentMonth);
    d.setMonth(d.getMonth() + offset);
    setCurrentMonth(d.toISOString().split('T')[0]);
  };

  const renderCustomHeader = (date: any) => {
    const locale = LocaleConfig.locales[i18n.language === 'fr' ? 'fr' : 'en'];
    const d = new Date(date.getTime());
    return (
      <View style={styles.calHeaderRow}>
        <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.calNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={18} color={colors.textMain} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.calMonthBtn} onPress={() => { setPickerYear(d.getFullYear()); setShowMonthPicker(true); }}>
          <Text style={styles.calMonthText}>{locale.monthNames[d.getMonth()]} {d.getFullYear()}</Text>
          <Feather name="chevron-down" size={13} color={colors.primary} style={{ marginLeft: 6 }} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => changeMonth(1)} style={styles.calNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-right" size={18} color={colors.textMain} />
        </TouchableOpacity>
      </View>
    );
  };

  const getHeaderDateText = () => {
    if (!dateRange?.start) return '…';
    const isFr = i18n.language === 'fr';
    const s = dateRange.start;
    const e = dateRange.end;
    const fmt = (d: Date) => d.toLocaleDateString(isFr ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' });
    if (s.toDateString() === e.toDateString()) return fmt(s);
    return isFr ? `Du ${fmt(s)} au ${fmt(e)}` : `${fmt(s)} – ${fmt(e)}`;
  };

  const formatDuration = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h === 0 ? `${m}m` : `${h}h ${m}m`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('analytics.title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + 16 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      >

        {/* ── DATE SELECTOR ── */}
        <TouchableOpacity style={styles.dateBtn} accessibilityRole="button" accessibilityLabel={t('analytics.calendar.selectDate')} onPress={() => {
          setSelectionStep(0);
          setTempStart(null);
          setCurrentMonth(dateRange.start.toISOString().split('T')[0]);
          setShowMonthPicker(false);
          setModalVisible(true);
        }} activeOpacity={0.75}>
          <View style={styles.dateBtnLeft}>
            <View style={styles.dateBtnIcon}>
              <Feather name="calendar" size={16} color={colors.primary} />
            </View>
            <Text style={styles.dateBtnText}>{getHeaderDateText()}</Text>
          </View>
          <Feather name="chevron-down" size={18} color={colors.textDimmed} />
        </TouchableOpacity>

        {fetchError && (
          <View style={styles.errorCard}>
            <Feather name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{t('errors.loadFailed', 'Erreur de chargement')}</Text>
            <TouchableOpacity onPress={fetchAnalytics}>
              <Text style={styles.errorRetry}>{t('errors.retry', 'Réessayer')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingWrap}>
            <BrandLoader size={12} />
            <Text style={styles.loadingText}>{t('analytics.loading')}</Text>
          </View>
        ) : (
          <>
            {/* ── HERO PROFIT CARD ── */}
            <AnimatedEntrance delay={0} slideFrom="bottom">
            <View
              style={styles.heroCard}
              accessible
              accessibilityLabel={`${t('analytics.netProfit')}: €${stats.totalProfit.toFixed(2)}`}
            >
              <SafeGradient
                colors={['#0F2D1F', '#0A150E']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              {/* top shimmer */}
              <View style={styles.heroShimmer} />

              <View style={styles.heroTop}>
                <Text style={styles.heroLabel}>{t('analytics.netProfit').toUpperCase()}</Text>
                <Text style={styles.heroBefore}>{t('analytics.beforeTax')}</Text>
              </View>
              <TouchableOpacity onPress={toggleProfitView} activeOpacity={hasFuelData ? 0.7 : 1}>
                <Animated.View style={{ transform: [{ scale: flipAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.92, 1] }) }] }}>
                  <Text style={styles.heroAmount}>
                    €{showNet ? (stats.totalProfit - stats.fuelCost).toFixed(2) : stats.totalProfit.toFixed(2)}
                  </Text>
                </Animated.View>
                {hasFuelData && (
                  <View style={styles.profitToggleRow}>
                    <View style={[styles.profitBadge, showNet && styles.profitBadgeActive]}>
                      <MaterialCommunityIcons
                        name={showNet ? 'gas-station' : 'cash-multiple'}
                        size={12}
                        color={showNet ? colors.primary : 'rgba(255,255,255,0.5)'}
                      />
                      <Text style={[styles.profitBadgeText, showNet && styles.profitBadgeTextActive]}>
                        {showNet ? t('analytics.netAfterFuel', 'Net après carburant') : t('analytics.grossProfit', 'Profit brut')}
                      </Text>
                    </View>
                    {showNet && (
                      <Text style={styles.fuelDetail}>-{stats.fuelCost.toFixed(2)}€ ⛽</Text>
                    )}
                  </View>
                )}
              </TouchableOpacity>
              <View style={styles.heroSep} />
              <View style={styles.heroStatsRow}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatVal}>{stats.acceptedCount}</Text>
                  <Text style={styles.heroStatLbl}>{t('history.status.ACCEPTED')}</Text>
                </View>
                <View style={styles.heroStatDiv} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatVal}>{stats.totalDistance.toFixed(1)} km</Text>
                  <Text style={styles.heroStatLbl}>{t('analytics.distance')}</Text>
                </View>
                <View style={styles.heroStatDiv} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatVal}>{formatDuration(stats.totalDurationMin)}</Text>
                  <Text style={styles.heroStatLbl}>{t('analytics.activeHours')}</Text>
                </View>
              </View>
            </View>
            </AnimatedEntrance>

            {/* ── KPI ROW ── */}
            <AnimatedEntrance delay={100} slideFrom="bottom">
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                {Platform.OS === 'ios' ? (
                  <>
                    <BlurView style={StyleSheet.absoluteFill} blurType="chromeMaterialDark" blurAmount={24} reducedTransparencyFallbackColor={colors.surface} />
                    <View style={[StyleSheet.absoluteFill, styles.kpiGlassTint]} />
                  </>
                ) : (
                  <SafeGradient
                    colors={['#1A2A22', '#141E18']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                <View style={styles.kpiShimmer} />
                <View style={styles.kpiIconWrap}>
                  <MaterialCommunityIcons name="speedometer" size={22} color={colors.primary} />
                </View>
                <View style={styles.kpiTextBlock}>
                  <Text style={styles.kpiLabel}>{t('analytics.hourlyRate')}</Text>
                  <Text style={styles.kpiValue}>€{stats.hourlyRate.toFixed(2)}</Text>
                </View>
              </View>
              <View style={styles.kpiCard}>
                {Platform.OS === 'ios' ? (
                  <>
                    <BlurView style={StyleSheet.absoluteFill} blurType="chromeMaterialDark" blurAmount={24} reducedTransparencyFallbackColor={colors.surface} />
                    <View style={[StyleSheet.absoluteFill, styles.kpiGlassTint]} />
                  </>
                ) : (
                  <SafeGradient
                    colors={['#1A2A22', '#141E18']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                <View style={styles.kpiShimmer} />
                <View style={styles.kpiIconWrap}>
                  <MaterialCommunityIcons name="map-marker-distance" size={22} color={colors.primary} />
                </View>
                <View style={styles.kpiTextBlock}>
                  <Text style={styles.kpiLabel}>{t('analytics.priceKm')}</Text>
                  <Text style={styles.kpiValue}>€{stats.pricePerKm.toFixed(2)}</Text>
                </View>
              </View>
            </View>
            </AnimatedEntrance>

            {/* ── EARNINGS CHART ── */}
            {dailyEarnings.length > 1 && (
              <EarningsChart
                data={dailyEarnings}
                title={t('analytics.dailyEarnings', 'Gains par jour')}
              />
            )}

            {/* ── KPI TRENDS ── */}
            {hourlyTrend.length > 1 && (
              <KpiTrendChart
                data={hourlyTrend}
                title={t('analytics.hourlyRate').toUpperCase()}
                unit="€/h"
                color={colors.primary}
              />
            )}
            {kmTrend.length > 1 && (
              <KpiTrendChart
                data={kmTrend}
                title={t('analytics.priceKm').toUpperCase()}
                unit="€/km"
                color="#4FC3F7"
              />
            )}

            {/* ── PLATFORM DISTRIBUTION ── */}
            <View style={styles.distCard}>
              <Text style={styles.distTitle}>{t('analytics.appDist')}</Text>

              {/* Combined stacked bar */}
              {stats.totalProfit > 0 && (
                <View style={styles.stackedBarWrap}>
                  <View style={styles.stackedBar}>
                    {PLATFORMS.map(p => {
                      const pct = stats.appDistribution[p.key];
                      if (pct === 0) return null;
                      return (
                        <View
                          key={p.key}
                          style={{ flex: pct, backgroundColor: p.color, height: '100%' }}
                        />
                      );
                    })}
                  </View>
                  <View style={styles.stackedLegend}>
                    {PLATFORMS.filter(p => stats.appDistribution[p.key] > 0).map(p => (
                      <View key={p.key} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: p.color }]} />
                        <Text style={styles.legendText}>{p.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View style={styles.distList}>
                {PLATFORMS.map(p => {
                  const pct = stats.appDistribution[p.key];
                  const earned = (stats.appEarnings as any)[p.key] as number;
                  // À 0% on neutralise le badge (sinon Heetch/Bolt prennent leur couleur
                  // brand même sans data — incohérent avec Uber blanc qui rend gris).
                  const badgeBg = pct === 0 ? 'rgba(255,255,255,0.06)' : p.color + '22';
                  const badgeFg = pct === 0 ? colors.textDimmed : p.color;
                  return (
                    <View key={p.key} style={styles.distItem}>
                      <View style={styles.distItemHeader}>
                        <View style={styles.distItemLeft}>
                          <View style={[styles.distDot, { backgroundColor: p.color }]} />
                          <Text style={styles.distLabel}>{p.label}</Text>
                        </View>
                        <View style={styles.distItemRight}>
                          <Text style={styles.distEarning}>€{earned.toFixed(2)}</Text>
                          <View style={[styles.distPctBadge, { backgroundColor: badgeBg }]}>
                            <Text style={[styles.distPctText, { color: badgeFg }]}>{pct}%</Text>
                          </View>
                        </View>
                      </View>
                      <View style={styles.distTrack}>
                        <View
                          style={[
                            styles.distFill,
                            { width: `${pct}%` as any, backgroundColor: p.color },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* ── PLUS UPSELL (free users) ── */}
            {!isPremium && (
              <TouchableOpacity
                style={styles.upsellCard}
                onPress={() => navigation.navigate('SubscriptionScreen')}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="crown" size={22} color={colors.primary} />
                <View style={styles.upsellText}>
                  <Text style={styles.upsellTitle}>{t('analytics.alerts.premiumTitle')}</Text>
                  <Text style={styles.upsellSub}>{t('analytics.alerts.premiumRequired')}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── CALENDAR MODAL ── */}
        <Modal
          visible={modalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => { setModalVisible(false); setModalAlert(''); }}
        >
          <Pressable style={styles.overlay} onPress={() => { setModalVisible(false); setModalAlert(''); }}>
            <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
              {showMonthPicker ? (
                <View>
                  <View style={styles.calHeaderRow}>
                    <TouchableOpacity onPress={() => setPickerYear(y => y - 1)} style={styles.yearNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.yearNavText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.calMonthText}>{pickerYear}</Text>
                    <TouchableOpacity onPress={() => setPickerYear(y => y + 1)} style={styles.yearNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.yearNavText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.monthGrid}>
                    {LocaleConfig.locales[i18n.language === 'fr' ? 'fr' : 'en'].monthNamesShort.map((m: string, idx: number) => {
                      const active = parseInt(currentMonth.split('-')[1]) - 1 === idx
                        && pickerYear === parseInt(currentMonth.split('-')[0]);
                      return (
                        <TouchableOpacity
                          key={idx}
                          style={[styles.monthCell, active && styles.monthCellActive]}
                          onPress={() => {
                            setCurrentMonth(`${pickerYear}-${String(idx + 1).padStart(2, '0')}-01`);
                            setShowMonthPicker(false);
                          }}
                        >
                          <Text style={[styles.monthCellText, active && styles.monthCellTextActive]}>{m}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : (
                <>
                  {modalAlert ? (
                    <View style={styles.modalAlertRow}>
                      <Feather name="alert-circle" size={14} color="#FFCA28" />
                      <Text style={styles.modalAlertText}>{modalAlert}</Text>
                    </View>
                  ) : null}
                <Calendar
                  key={currentMonth}
                  current={currentMonth}
                  onMonthChange={(month: any) => setCurrentMonth(month.dateString)}
                  firstDay={1}
                  hideExtraDays
                  hideArrows
                  renderHeader={renderCustomHeader}
                  onDayPress={handleDayPress}
                  markingType="period"
                  markedDates={getMarkedDates()}
                  theme={{
                    calendarBackground: colors.surface,
                    textSectionTitleColor: colors.textMuted,
                    todayTextColor: colors.primary,
                    dayTextColor: colors.textMain,
                    textDisabledColor: colors.surfaceLight,
                    textDayFontWeight: '500',
                    textDayHeaderFontWeight: '600',
                    textDayFontSize: 15,
                    textDayHeaderFontSize: 13,
                  }}
                />
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,77,77,0.08)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,77,77,0.2)',
    padding: 14, marginBottom: 12,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 13, fontWeight: '500' },
  errorRetry: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  loadingWrap: { alignItems: 'center', paddingTop: 80, gap: 20 },
  loadingRing: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  loadingText: { color: colors.textDimmed, fontSize: 13, fontWeight: '500' },

  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingVertical: 15 },
  headerTitle: { color: colors.textMain, fontSize: 24, fontWeight: 'bold' },
  scroll: { paddingHorizontal: 20 },

  // Date button
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  dateBtnLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateBtnIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: 'rgba(0,230,118,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  dateBtnText: { color: colors.textMain, fontSize: 15, fontWeight: '600', textTransform: 'capitalize' },

  // Hero card — liquid glass
  heroCard: {
    borderRadius: 22,
    padding: 22,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,230,118,0.28)',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  heroGlassTint: {
    backgroundColor: 'rgba(0, 230, 118, 0.07)',
  },
  heroShimmer: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: 'rgba(0,230,118,0.35)',
    borderRadius: 1,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  heroLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  heroBefore: { color: colors.textDimmed, fontSize: 11 },
  heroAmount: {
    color: colors.textMain,
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: -2,
    marginBottom: 6,
    textAlign: 'center',
  },
  profitToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14,
  },
  profitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  profitBadgeActive: {
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderColor: 'rgba(0,230,118,0.2)',
  },
  profitBadgeText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
  },
  profitBadgeTextActive: {
    color: colors.primary,
  },
  fuelDetail: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontWeight: '600',
  },
  heroSep: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginBottom: 18 },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatVal: { color: colors.textMain, fontSize: 15, fontWeight: '800', marginBottom: 3 },
  heroStatLbl: { color: colors.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.4, textAlign: 'center' },
  heroStatDiv: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.08)' },

  // KPI row — liquid glass
  kpiRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  kpiCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    padding: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  kpiGlassTint: {
    backgroundColor: 'rgba(10, 22, 15, 0.45)',
  },
  kpiShimmer: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 1,
  },
  kpiIconWrap: {
    width: 44, height: 44, borderRadius: 13,
    backgroundColor: 'rgba(0,230,118,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  kpiTextBlock: { flex: 1 },
  kpiLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 },
  kpiValue: { color: colors.textMain, fontSize: 22, fontWeight: '900' },

  // Platform distribution
  distCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  distTitle: { color: colors.textMain, fontSize: 15, fontWeight: 'bold', marginBottom: 16 },

  // Stacked combined bar
  stackedBarWrap: { marginBottom: 22 },
  stackedBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 10,
  },
  stackedLegend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },

  distList: { gap: 18 },
  distItem: { gap: 10 },
  distItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  distItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  distDot: { width: 10, height: 10, borderRadius: 5 },
  distLabel: { color: colors.textMain, fontSize: 14, fontWeight: '700' },
  distItemRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  distEarning: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  distPctBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
  },
  distPctText: { fontSize: 12, fontWeight: '900' },
  distTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  distFill: { height: 8, borderRadius: 4 },

  // Upsell
  upsellCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,230,118,0.06)',
    borderRadius: 16,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.18)',
    marginBottom: 8,
  },
  upsellText: { flex: 1 },
  upsellTitle: { color: colors.textMain, fontSize: 14, fontWeight: 'bold', marginBottom: 3 },
  upsellSub: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },

  // Calendar modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 16,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  calHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 10,
    gap: 14,
  },
  calMonthBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.18)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
  },
  calMonthText: { color: colors.textMain, fontSize: 15, fontWeight: '800' },
  yearNavBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  yearNavText: { color: colors.textMain, fontSize: 18, fontWeight: '800', lineHeight: 20 },
  calNavBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },

  modalAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,202,40,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,202,40,0.2)',
  },
  modalAlertText: { color: '#FFCA28', fontSize: 12, flex: 1, lineHeight: 17 },

  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  monthCell: {
    width: '30%',
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  monthCellActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  monthCellText: { color: colors.textMain, fontSize: 13, fontWeight: '700' },
  monthCellTextActive: { color: '#06140C', fontWeight: '900' },
});

export default AnalyticsScreen;
