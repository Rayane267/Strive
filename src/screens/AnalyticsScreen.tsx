import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  RefreshControl,
  Platform,
  Animated,
  AppState,
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
import { getEffectivePlanTier, getPlanLimits, FREE_THRESHOLDS } from '../services/subscriptionService';
import { fetchRides } from '../services/ridesService';
import { computeWeeklyBilan } from '../utils/weeklyTease';
import { effectiveFare } from '../services/ridesService';
import { useNavigation } from '@react-navigation/native';
import { getDayStart, toLocalDateKey, getBusinessDayKey, parseLocalDateKey } from '../utils/dateUtils';
import EarningsChart from '../components/EarningsChart';
import KpiTrendChart from '../components/KpiTrendChart';
import QualityScoreCard from '../components/QualityScoreCard';
import { computeQualityScore, QualityScore } from '../utils/qualityScore';
import AnimatedEntrance from '../components/AnimatedEntrance';
import { Skeleton } from '../components/Skeleton';
import { cacheStats, getCachedStats } from '../services/offlineService';
import { fetchFuelPrice } from '../services/fuelService';

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

  // Re-read day_reset_hour on focus so a change in Preferences is picked up
  useFocusEffect(useCallback(() => {
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
  }, [user]));

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [isEmpty, setIsEmpty] = useState(false);
  const [isPremium, setIsPremium] = useState(false);

  // Bilan de la semaine (Plus uniquement) : manque à gagner vs objectif + courses
  // non rentables évitées, sur les 7 derniers jours. Insight, pas paywall.
  useEffect(() => {
    if (!user?.id || !isPremium) { setWeeklyBilan({ lossWeek: 0, avoided: 0 }); return; }
    (async () => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const [prefsRes, weekRides] = await Promise.all([
          supabase.from('preferences').select('min_hourly_rate, min_km_rate').eq('id', user.id).single(),
          fetchRides(user.id, since),
        ]);
        const mh = Number(prefsRes.data?.min_hourly_rate ?? 25) || 25;
        const mk = Number(prefsRes.data?.min_km_rate ?? 1.2) || 1.2;
        setWeeklyBilan(computeWeeklyBilan(weekRides, mh, mk));
      } catch {
        setWeeklyBilan({ lossWeek: 0, avoided: 0 });
      }
    })();
  }, [user?.id, isPremium]);
  const [dateRange, setDateRange] = useState({ start: new Date(), end: new Date() });
  const [modalVisible, setModalVisible] = useState(false);
  const [selectionStep, setSelectionStep] = useState(0);
  const [tempStart, setTempStart] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(toLocalDateKey(new Date()));
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

  // Vue brut/net synchronisée : le profit affiché pilote aussi €/h et €/km.
  // Ces deux KPI sont linéaires en profit (profit/h, profit/km) → on applique
  // le même ratio net/brut pour rester exact sans recalculer heures/distance.
  const displayProfit = showNet ? stats.totalProfit - stats.fuelCost : stats.totalProfit;
  const netRatio = stats.totalProfit > 0 ? displayProfit / stats.totalProfit : 1;
  const displayHourly = stats.hourlyRate * netRatio;
  const displayPerKm = stats.pricePerKm * netRatio;

  // Le « bilan de la semaine » ne concerne que la semaine en cours : masqué dès
  // qu'on consulte une période dont la fin est antérieure au lundi de cette semaine.
  const isCurrentWeekView = (() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const end = dateRange?.end ? new Date(dateRange.end) : now;
    return end >= weekStart;
  })();

  const toggleProfitView = () => {
    if (!hasFuelData) return;
    const toNet = !showNet;
    setShowNet(toNet);
    Animated.spring(flipAnim, { toValue: toNet ? 1 : 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
  };

  const [dailyEarnings, setDailyEarnings] = useState<{ label: string; earnings: number; isToday?: boolean }[]>([]);
  const [weeklyBilan, setWeeklyBilan] = useState<{ lossWeek: number; avoided: number }>({ lossWeek: 0, avoided: 0 });
  const [hourlyTrend, setHourlyTrend] = useState<{ label: string; value: number }[]>([]);
  const [kmTrend, setKmTrend] = useState<{ label: string; value: number }[]>([]);
  const [qualityScore, setQualityScore] = useState<QualityScore | null>(null);

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
        .select('subscription_tier, subscription_expires_at, avg_cons, fuel_type, elec_price')
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

      // Parallélise rides + sessions + seuils (round-trips indépendants → -1 RTT)
      const [
        { data: rides, error: ridesError },
        { data: sessionsData, error: sessionsError },
        { data: prefsData },
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
        supabase
          .from('preferences')
          .select('min_hourly_rate, min_km_rate')
          .eq('id', user.id)
          .single(),
      ]);

      if (ridesError) throw ridesError;
      if (sessionsError) throw sessionsError;

      if (!rides || rides.length === 0) {
        const emptyStats = { totalProfit: 0, totalDistance: 0, totalDurationMin: 0, hourlyRate: 0, pricePerKm: 0, acceptedCount: 0, fuelCost: 0, appDistribution: { UBER: 0, BOLT: 0, HEETCH: 0 }, appEarnings: { UBER: 0, BOLT: 0, HEETCH: 0 } };
        setStats(emptyStats);
        setDailyEarnings([]);
        setHourlyTrend([]);
        setKmTrend([]);
        setQualityScore(null);
        setIsEmpty(true);
        return;
      }
      setIsEmpty(false);

      // Seuils IMPOSÉS en free, comme au scan (DashboardScreen) : sinon un
      // compte qui a personnalisé ses seuils avant de repasser free voit ici un
      // score qualité calculé sur des seuils que le scanner n'a jamais
      // appliqués — la carte et le verdict de la même course se contredisent.
      const isFree = planTier === 'free';
      const minHourly = isFree
        ? FREE_THRESHOLDS.hourly
        : Number(prefsData?.min_hourly_rate ?? 25) || 25;
      const minKm = isFree
        ? FREE_THRESHOLDS.km
        : Number(prefsData?.min_km_rate ?? FREE_THRESHOLDS.km) || FREE_THRESHOLDS.km;
      setQualityScore(computeQualityScore(rides as any, minHourly, minKm));

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
      const todayStr = getBusinessDayKey(new Date(), resetHour);

      const dailyMap = new Map<string, { earnings: number; distance: number; hours: number }>();
      acceptedRides.forEach((ride: any) => {
        // Jour de travail local (cf. day_reset_hour), pas le jour UTC : sinon une
        // course de nuit atterrit dans la mauvaise barre du graphe.
        const dateKey = getBusinessDayKey(ride.created_at, resetHour);
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
        // cursor est déjà positionné à resetHour → sa date locale EST la clé du jour
        const key = toLocalDateKey(cursor);
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

      // Prix unitaire résolu par le service partagé (table fuel_prices pour les
      // carburants liquides, prix €/kWh perso pour l'électrique).
      const avgCons = profileData?.avg_cons ?? 0;
      const fuelType = profileData?.fuel_type ?? 'essence';
      const fuelPrice = avgCons > 0 ? await fetchFuelPrice(fuelType, profileData?.elec_price) : 0;
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
      // fuelCost ajouté après coup : les payloads AsyncStorage existants ne l'ont pas
      if (cached) setStats({ ...cached, fuelCost: cached.fuelCost ?? 0 });
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [user, dateRange, resetHour, i18n.language]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAnalytics();
    setRefreshing(false);
  }, [fetchAnalytics]);

  useFocusEffect(useCallback(() => { fetchAnalytics(); }, [fetchAnalytics]));

  // Re-fetch on foreground resume (picks up new day boundary automatically)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setDateRange({ start: getDayStart(resetHour), end: getDayStart(resetHour) });
      }
    });
    return () => sub.remove();
  }, [resetHour]);

  const handleDayPress = (day: any) => {
    const todayString = getBusinessDayKey(new Date(), resetHour);
    if (!isPremium && day.dateString !== todayString) {
      setModalAlert(t('analytics.alerts.premiumRequired'));
      return;
    }
    setModalAlert('');
    if (selectionStep === 0) {
      setTempStart(day.dateString);
      setSelectionStep(1);
    } else {
      const start = parseLocalDateKey(tempStart!);
      const end = parseLocalDateKey(day.dateString);
      if (end < start) { setTempStart(day.dateString); return; }
      const diffDays = Math.ceil(Math.abs(end.getTime() - start.getTime()) / 86400000);
      if (diffDays > 6) {
        setModalAlert(t('analytics.alerts.limitText', 'Max 7 jours.'));
        setTempStart(day.dateString);
        return;
      }
      setDateRange({ start, end });
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
      const startStr = toLocalDateKey(dateRange.start);
      const endStr = toLocalDateKey(dateRange.end);
      if (startStr === endStr) {
        marks[startStr] = { startingDay: true, endingDay: true, color: edge, textColor: edgeText };
      } else {
        let curr = parseLocalDateKey(startStr);
        const last = parseLocalDateKey(endStr);
        while (curr <= last) {
          const ds = toLocalDateKey(curr);
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
    const d = parseLocalDateKey(currentMonth);
    d.setMonth(d.getMonth() + offset);
    setCurrentMonth(toLocalDateKey(d));
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
          <Feather name="chevron-down" size={13} color={colors.primaryInk} style={{ marginLeft: 6 }} />
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
          setCurrentMonth(toLocalDateKey(dateRange.start));
          setShowMonthPicker(false);
          setModalVisible(true);
        }} activeOpacity={0.75}>
          <View style={styles.dateBtnLeft}>
            <View style={styles.dateBtnIcon}>
              <Feather name="calendar" size={16} color={colors.primaryInk} />
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
          <View style={styles.skeletonWrap}>
            <Skeleton width="100%" height={180} radius={24} />
            <View style={styles.skeletonTilesRow}>
              <Skeleton width="48%" height={90} radius={18} />
              <Skeleton width="48%" height={90} radius={18} />
            </View>
            <Skeleton width="100%" height={200} radius={20} />
          </View>
        ) : isEmpty ? (
          <View style={styles.analyticsEmpty}>
            <View style={styles.analyticsEmptyIcon}>
              <MaterialCommunityIcons name="chart-line-variant" size={34} color={colors.primaryInk} />
            </View>
            <Text style={styles.analyticsEmptyTitle}>{t('analytics.empty.title', 'Aucune donnée pour le moment')}</Text>
            <Text style={styles.analyticsEmptyHint}>
              {t('analytics.empty.hint', 'Scanne ta première course pour voir tes revenus, ton taux horaire et tes tendances ici.')}
            </Text>
            <TouchableOpacity
              style={styles.analyticsEmptyCta}
              onPress={() => navigation.navigate('Dashboard' as never)}
              accessibilityRole="button"
              accessibilityLabel={t('history.emptyCta', 'Lancer un scan')}
            >
              <MaterialCommunityIcons name="line-scan" size={16} color={colors.background} />
              <Text style={styles.analyticsEmptyCtaText}>{t('history.emptyCta', 'Lancer un scan')}</Text>
            </TouchableOpacity>
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
              </View>
              <TouchableOpacity onPress={toggleProfitView} activeOpacity={hasFuelData ? 0.7 : 1}>
                <Animated.View style={{ transform: [{ scale: flipAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.92, 1] }) }] }}>
                  <Text style={styles.heroAmount}>
                    €{displayProfit.toFixed(2)}
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
                    <BlurView style={StyleSheet.absoluteFill} blurType="light" blurAmount={24} reducedTransparencyFallbackColor={colors.surface} />
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
                  <MaterialCommunityIcons name="speedometer" size={22} color={colors.primaryInk} />
                </View>
                <View style={styles.kpiTextBlock}>
                  <Text style={styles.kpiLabel}>{t('analytics.hourlyRate')}</Text>
                  <Text style={styles.kpiValue}>€{displayHourly.toFixed(2)}</Text>
                </View>
              </View>
              <View style={styles.kpiCard}>
                {Platform.OS === 'ios' ? (
                  <>
                    <BlurView style={StyleSheet.absoluteFill} blurType="light" blurAmount={24} reducedTransparencyFallbackColor={colors.surface} />
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
                  <MaterialCommunityIcons name="map-marker-distance" size={22} color={colors.primaryInk} />
                </View>
                <View style={styles.kpiTextBlock}>
                  <Text style={styles.kpiLabel}>{t('analytics.priceKm')}</Text>
                  <Text style={styles.kpiValue}>€{displayPerKm.toFixed(2)}</Text>
                </View>
              </View>
            </View>
            </AnimatedEntrance>

            {/* ── QUALITÉ DES COURSES + BILAN DE LA SEMAINE (cartes insight) ── */}
            {qualityScore && (
              <AnimatedEntrance delay={150} slideFrom="bottom">
                <QualityScoreCard score={qualityScore} />
              </AnimatedEntrance>
            )}

            {isPremium && isCurrentWeekView && (weeklyBilan.lossWeek > 0 || weeklyBilan.avoided > 0) && (
              <AnimatedEntrance delay={175} slideFrom="bottom">
                <View style={styles.bilanCard}>
                  <Text style={styles.bilanTitle}>{t('analytics.weeklyBilan.title', 'Bilan de la semaine')}</Text>
                  {weeklyBilan.lossWeek > 0 && (
                    <Text style={styles.bilanLoss}>
                      {t('analytics.weeklyBilan.loss', { eur: weeklyBilan.lossWeek.toFixed(0) })}
                    </Text>
                  )}
                  {weeklyBilan.avoided > 0 && (
                    <Text style={styles.bilanAvoided}>
                      {t('analytics.weeklyBilan.avoided', { count: weeklyBilan.avoided })}
                    </Text>
                  )}
                </View>
              </AnimatedEntrance>
            )}

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
                color={colors.primaryInk}
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
                <MaterialCommunityIcons name="crown" size={22} color={colors.primaryInk} />
                <View style={styles.upsellText}>
                  <Text style={styles.upsellTitle}>{t('analytics.alerts.premiumTitle')}</Text>
                  <Text style={styles.upsellSub}>{t('analytics.alerts.premiumRequired')}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.primaryInk} />
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
                  {/* Alerte conditionnelle, placee APRES le calendrier : au-dessus,
                      son apparition poussait toute la grille vers le bas, en pleine
                      selection et sous le doigt. Ici la grille ne bouge pas. */}
                  {modalAlert ? (
                    <View style={styles.modalAlertRow}>
                      <Feather name="alert-circle" size={14} color={colors.danger} />
                      <Text style={styles.modalAlertText}>{modalAlert}</Text>
                    </View>
                  ) : null}
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
  errorRetry: { color: colors.primaryInk, fontSize: 13, fontWeight: '700' },
  // Loading skeleton
  skeletonWrap: { gap: 14, paddingTop: 4 },
  skeletonTilesRow: { flexDirection: 'row', justifyContent: 'space-between' },

  // Empty state (aucune course)
  analyticsEmpty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24, gap: 12 },
  analyticsEmptyIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  analyticsEmptyTitle: { color: colors.textMain, fontSize: 17, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  analyticsEmptyHint: { color: colors.textDimmed, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  analyticsEmptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 8,
  },
  analyticsEmptyCtaText: { color: colors.background, fontWeight: '800', fontSize: 14 },

  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingVertical: 15 },
  headerTitle: { color: colors.textMain, fontSize: 24, fontWeight: 'bold' },
  scroll: { paddingHorizontal: 20 },
  bilanCard: {
    backgroundColor: 'rgba(0,230,118,0.06)',
    borderColor: 'rgba(0,230,118,0.25)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  bilanTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  bilanLoss: { color: colors.textMain, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  bilanAvoided: { color: colors.primaryInk, fontSize: 14, fontWeight: '700' },

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
    color: colors.primaryInk,
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

  // Rouge `danger` de la palette, et non un orange pose a la main hors systeme.
  // Place sous le calendrier : voir le commentaire au point de rendu.
  modalAlertRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,77,77,0.10)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, marginTop: 12,
    borderWidth: 1, borderColor: 'rgba(255,77,77,0.22)',
  },
  modalAlertText: { color: colors.danger, fontSize: 12, flex: 1, lineHeight: 17 },

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
