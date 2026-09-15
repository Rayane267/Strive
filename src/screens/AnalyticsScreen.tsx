import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  RefreshControl,
  Platform,
  Animated,
  AppState,
  Image,
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
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { elevation } from '../theme/elevation';
import { stroke, strokeWidth } from '../theme/stroke';
import { FIELD_TOP } from '../theme/field';
import ScreenField from '../components/ScreenField';
import { hapticSelection } from '../utils/haptics';
import { getEffectivePlanTier, getMaxRangeSpanDays, type PlanTier } from '../services/subscriptionService';
import { fetchRides, fetchRidesInRange } from '../services/ridesService';
import { computeWeeklyBilan } from '../utils/weeklyTease';
import { effectiveFare } from '../services/ridesService';
import { useNavigation } from '@react-navigation/native';
import { getDayStart, getWeekStart, toLocalDateKey, getBusinessDayKey, parseLocalDateKey } from '../utils/dateUtils';
import {
  pickGranularity,
  foldSeries,
  toRateSeries,
  type Granularity,
  type DayPoint,
} from '../utils/chartBuckets';
import EarningsChart from '../components/EarningsChart';
import KpiTrendChart from '../components/KpiTrendChart';
import QualityScoreCard from '../components/QualityScoreCard';
import { computeQualityScore, QualityScore } from '../utils/qualityScore';
import AnimatedEntrance from '../components/AnimatedEntrance';
import { Skeleton } from '../components/Skeleton';
import { cacheStats, getCachedStats } from '../services/offlineService';
import { fetchFuelPrice } from '../services/fuelService';
import { useMarket } from '../hooks/useMarket';
import { formatMoney, hourlyUnit, distanceUnitLabel } from '../utils/market';
import { calendarLocale } from '../utils/calendarLocales';


const PLATFORMS = [
  { key: 'UBER',   label: 'Uber',   color: '#FFFFFF' },
  { key: 'BOLT',   label: 'Bolt',   color: '#34BB78' },
  { key: 'HEETCH', label: 'Heetch', color: '#FF3B80' },
] as const;

const AnalyticsScreen = () => {
  const market = useMarket();
  /** Montants à deux décimales, dans la devise du marché. */
  const money2 = (n: number) => formatMoney(n, market, { decimals: 2 });
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<any>();

  const [resetHour, setResetHour] = useState(0);

  useEffect(() => {
    LocaleConfig.defaultLocale = calendarLocale(i18n.language);
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
  // Payant = 'plus' OU 'premium' : c'est ce qui ouvre l'historique tout court.
  // L'ÉTENDUE de la fenêtre, elle, dépend du tier exact (cf. getMaxRangeSpanDays),
  // d'où deux états là où un booléen suffisait quand Plus était le seul palier.
  const [isPaid, setIsPaid] = useState(false);
  const [planTier, setPlanTier] = useState<PlanTier>('free');

  // Bilan de la semaine (Plus uniquement) : manque à gagner vs objectif + courses
  // non rentables évitées, sur la semaine EN COURS. Insight, pas paywall.
  //
  // La fenêtre glissante de 7 jours contredisait `isCurrentWeekView` juste en
  // dessous, qui décide de l'affichage de la carte sur un lundi de référence :
  // le même écran appelait « semaine » deux périodes différentes.
  useEffect(() => {
    if (!user?.id || !isPaid) { setWeeklyBilan({ lossWeek: 0, avoided: 0 }); return; }
    (async () => {
      try {
        const since = getWeekStart(resetHour);
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
  }, [user?.id, isPaid, resetHour]);
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
    const weekStart = getWeekStart(resetHour);
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
  /// Maille des graphes. Elle décide aussi de leur TITRE : « Gains par jour »
  /// sur des barres hebdomadaires serait faux.
  const [granularity, setGranularity] = useState<Granularity>('day');

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
        .select('subscription_tier, subscription_expires_at, avg_cons, fuel_type, elec_price, fuel_price')
        .eq('id', user.id)
        .single();

      const tier = getEffectivePlanTier(profileData);
      const canAccessHistory = tier !== 'free';
      setPlanTier(tier);
      setIsPaid(canAccessHistory);

      let rangeStart = canAccessHistory && dateRange?.start ? new Date(dateRange.start) : getDayStart(resetHour);
      rangeStart.setHours(resetHour, 0, 0, 0);

      let rangeEnd = canAccessHistory && dateRange?.end ? new Date(dateRange.end) : new Date(rangeStart);
      rangeEnd.setDate(rangeEnd.getDate() + 1);
      rangeEnd.setHours(resetHour, 0, 0, 0);

      // Parallélise rides + sessions + seuils (round-trips indépendants → -1 RTT)
      const [
        rides,
        { data: sessionsData, error: sessionsError },
        { data: prefsData },
      ] = await Promise.all([
        fetchRidesInRange(user.id, rangeStart, rangeEnd),
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
      const isFree = tier === 'free';
      const floor = market.thresholds;
      const minHourly = isFree
        ? floor.hourly
        : Number(prefsData?.min_hourly_rate ?? floor.hourly) || floor.hourly;
      const minKm = isFree
        ? floor.distance
        : Number(prefsData?.min_km_rate ?? floor.distance) || floor.distance;
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

      // Série JOURNALIÈRE brute, trous compris : un jour sans course vaut zéro
      // et doit exister, sinon la semaine se resserre et le graphe ment sur le
      // rythme réel.
      const rawDays: DayPoint[] = [];
      const cursor = new Date(rangeStart);
      while (cursor < rangeEnd) {
        // cursor est déjà positionné à resetHour → sa date locale EST la clé du jour
        const key = toLocalDateKey(cursor);
        const dayData = dailyMap.get(key);
        rawDays.push({
          key,
          date: new Date(cursor),
          earnings: dayData?.earnings || 0,
          distance: dayData?.distance || 0,
          hours: dayData?.hours || 0,
          isToday: key === todayStr,
        });
        cursor.setDate(cursor.getDate() + 1);
      }

      // Puis on replie à la maille qui reste lisible sur un téléphone. Les taux
      // se recalculent APRÈS le repli, à partir des sommes : moyenner des €/h
      // journaliers donnerait le même poids à une vacation de dix heures et à
      // une course isolée.
      const gran = pickGranularity(rawDays.length);
      const folded = foldSeries(rawDays, gran, { locale: i18n.language, dayLabels });

      setGranularity(gran);
      setDailyEarnings(folded.map(p => ({
        label: p.label,
        earnings: p.earnings,
        isToday: p.isToday,
      })));
      setHourlyTrend(toRateSeries(folded, 'hours'));
      setKmTrend(toRateSeries(folded, 'distance'));

      const totalOnlineHours = totalOnlineSeconds / 3600;

      // Prix unitaire résolu par le service partagé (table fuel_prices pour les
      // carburants liquides, prix €/kWh perso pour l'électrique).
      const avgCons = profileData?.avg_cons ?? 0;
      const fuelType = profileData?.fuel_type ?? 'essence';
      const fuelPrice = avgCons > 0 ? await fetchFuelPrice(
              fuelType,
              { elecPrice: profileData?.elec_price, fuelPrice: profileData?.fuel_price },
              market,
            ) : 0;
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
  }, [user, dateRange, resetHour, i18n.language, market]);

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
    if (!isPaid && day.dateString !== todayString) {
      setModalAlert(t('analytics.alerts.premiumRequired'));
      return;
    }
    setModalAlert('');
    hapticSelection();
    if (selectionStep === 0) {
      setTempStart(day.dateString);
      setSelectionStep(1);
    } else {
      const start = parseLocalDateKey(tempStart!);
      const end = parseLocalDateKey(day.dateString);
      if (end < start) { setTempStart(day.dateString); return; }
      const diffDays = Math.ceil(Math.abs(end.getTime() - start.getTime()) / 86400000);
      const maxSpan = getMaxRangeSpanDays(planTier);
      if (maxSpan !== null && diffDays > maxSpan) {
        setModalAlert(t('analytics.alerts.limitText', { days: maxSpan + 1 }));
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
    const locale = LocaleConfig.locales[calendarLocale(i18n.language)];
    const d = new Date(date.getTime());
    return (
      <View style={styles.calHeaderRow}>
        <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.calNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={18} color={colors.textMain} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.calMonthBtn} onPress={() => { setPickerYear(d.getFullYear()); setShowMonthPicker(true); }}>
          <Text style={styles.calMonthText}>{locale.monthNames[d.getMonth()]} {d.getFullYear()}</Text>
          <Feather name="chevron-down" size={13} color={colors.textMuted} style={{ marginLeft: space.sm }} />
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

  // Défilement de l'écran, lu par les surfaces de verre : le champ est fixe à
  // l'appareil, c'est donc cette valeur qui leur dit où elles sont dans la lumière.
  const scrollY = useRef(new Animated.Value(0)).current;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Posé en premier, donc derrière tout le reste. */}
      <ScreenField />

      {/* ── HEADER ── */}
      <AnimatedEntrance step={0} style={styles.header}>
        <Text style={styles.headerTitle}>{t('analytics.title')}</Text>
      </AnimatedEntrance>

      <Animated.ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + 16 }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
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
              <Feather name="calendar" size={16} color={colors.textMuted} />
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

        {/* ── MEILLEURS CRÉNEAUX ── */}
        {/* HORS des trois branches ci-dessus, et c'est le point.
            Placée dans la branche « il y a des courses », la carte disparaissait
            dès que la PÉRIODE AFFICHÉE était vide — typiquement le défaut, qui
            montre la journée en cours. Un chauffeur qui n'a rien fait
            aujourd'hui ne voyait donc jamais l'entrée d'un écran qui analyse ses
            90 DERNIERS JOURS : exactement l'inverse de ce qu'il faut, puisque
            c'est lui qui a le plus besoin de savoir quand travailler.

            Visible pour tous, free compris : l'écran porte son propre mur
            Premium et montre ce qu'on achète. Le cacher ne vendrait rien. */}
        {!loading && (
          <AnimatedEntrance step={4} slideFrom="bottom">
            <TouchableOpacity
              style={styles.slotsCard}
              onPress={() => navigation.navigate('BestHours')}
              activeOpacity={0.85}
            >
              <View style={styles.slotsIcon}>
                <Feather name="clock" size={18} color={colors.textMuted} />
              </View>
              <View style={styles.slotsText}>
                <Text style={styles.slotsTitle}>{t('bestHours.cardTitle')}</Text>
                <Text style={styles.slotsSub}>{t('bestHours.cardSub')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.textDimmed} />
            </TouchableOpacity>
          </AnimatedEntrance>
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
              <MaterialCommunityIcons name="chart-line-variant" size={34} color={colors.primary} />
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
            <AnimatedEntrance step={0} slideFrom="bottom">
            <View
              style={styles.heroCard}
              accessible
              accessibilityLabel={`${t('analytics.netProfit')}: ${money2(stats.totalProfit)}`}
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
                    {money2(displayProfit)}
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
                      <Text style={styles.fuelDetail}>-{money2(stats.fuelCost)} ⛽</Text>
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
            <AnimatedEntrance step={1} slideFrom="bottom">
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
                  <Text style={styles.kpiValue}>{money2(displayHourly)}</Text>
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
                  <Text style={styles.kpiValue}>{money2(displayPerKm)}</Text>
                </View>
              </View>
            </View>
            </AnimatedEntrance>

            {/* ── QUALITÉ DES COURSES + BILAN DE LA SEMAINE (cartes insight) ── */}
            {qualityScore && (
              <AnimatedEntrance step={2} slideFrom="bottom">
                <QualityScoreCard score={qualityScore} />
              </AnimatedEntrance>
            )}

            {isPaid && isCurrentWeekView && (weeklyBilan.lossWeek > 0 || weeklyBilan.avoided > 0) && (
              <AnimatedEntrance step={3} slideFrom="bottom">
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
                title={t(`analytics.earningsBy.${granularity}`)}
              />
            )}

            {/* ── KPI TRENDS ── */}
            {hourlyTrend.length > 1 && (
              <KpiTrendChart
                data={hourlyTrend}
                title={t('analytics.hourlyRate').toUpperCase()}
                unit={hourlyUnit(market)}
                color={colors.primary}
              />
            )}
            {kmTrend.length > 1 && (
              <KpiTrendChart
                data={kmTrend}
                title={t('analytics.priceKm').toUpperCase()}
                unit={distanceUnitLabel(market)}
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
                          <Text style={styles.distEarning}>{money2(earned)}</Text>
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
            {!isPaid && (
              <TouchableOpacity
                style={styles.upsellCard}
                onPress={() => navigation.navigate('SubscriptionScreen')}
                activeOpacity={0.85}
              >
                <Image
                  source={require('../assets/strive-logo.png')}
                  style={styles.upsellLogo}
                />
                <View style={styles.upsellText}>
                  <Text style={styles.upsellTitle}>{t('analytics.alerts.premiumTitle')}</Text>
                  <Text style={styles.upsellSub}>{t('analytics.alerts.premiumRequired')}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.textMuted} />
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
                    {LocaleConfig.locales[calendarLocale(i18n.language)].monthNamesShort.map((m: string, idx: number) => {
                      const active = parseInt(currentMonth.split('-')[1]) - 1 === idx
                        && pickerYear === parseInt(currentMonth.split('-')[0]);
                      return (
                        <AnimatedEntrance key={idx} step={Math.floor(idx / 3)} style={styles.monthCellSlot}>
                        <TouchableOpacity
                          style={[styles.monthCell, active && styles.monthCellActive]}
                          onPress={() => {
                            setCurrentMonth(`${pickerYear}-${String(idx + 1).padStart(2, '0')}-01`);
                            setShowMonthPicker(false);
                          }}
                        >
                          <Text style={[styles.monthCellText, active && styles.monthCellTextActive]}>{m}</Text>
                        </TouchableOpacity>
                        </AnimatedEntrance>
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
                    calendarBackground: 'transparent',
                    textSectionTitleColor: colors.textMuted,
                    todayTextColor: colors.primary,
                    dayTextColor: colors.textMain,
                    textDisabledColor: colors.surfaceLight,
                    selectedDayBackgroundColor: colors.primary,
                    selectedDayTextColor: colors.onPrimary,
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

      </Animated.ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: 'rgba(255,77,77,0.08)', borderRadius: radius.sm,
    borderWidth: strokeWidth.control, borderColor: stroke.alert,
    padding: space.md, marginBottom: space.md,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 13, fontWeight: '500' },
  errorRetry: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  // Loading skeleton
  skeletonWrap: { gap: space.md, paddingTop: space.xs },
  skeletonTilesRow: { flexDirection: 'row', justifyContent: 'space-between' },

  // Empty state (aucune course)
  analyticsEmpty: { alignItems: 'center', paddingTop: space.xxxl, paddingHorizontal: space.xl, gap: space.md },
  analyticsEmptyIcon: {
    width: 72, height: 72, borderRadius: radius.full,
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderWidth: strokeWidth.control, borderColor: stroke.active,
    justifyContent: 'center', alignItems: 'center',
  },
  analyticsEmptyTitle: { color: colors.textMain, fontSize: 17, fontWeight: '800', textAlign: 'center', marginTop: space.xs },
  analyticsEmptyHint: { color: colors.textDimmed, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  analyticsEmptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.md, marginTop: space.sm,
  },
  analyticsEmptyCtaText: { color: colors.background, fontWeight: '800', fontSize: 14 },

  // Même couleur que le sommet du champ : la bande sous l'encoche se confond
  // avec lui au lieu de former un bandeau plus sombre.
  container: { flex: 1, backgroundColor: FIELD_TOP },
  header: { paddingHorizontal: space.xl, paddingVertical: space.lg },
  headerTitle: { color: colors.textMain, fontSize: 24, fontWeight: 'bold' },
  scroll: { paddingHorizontal: space.xl },
  bilanCard: {
    backgroundColor: 'rgba(0,230,118,0.06)',
    borderColor: stroke.edge,
    borderWidth: strokeWidth.control,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.md,
  },
  bilanTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space.sm },
  bilanLoss: { color: colors.textMain, fontSize: 16, fontWeight: '800', marginBottom: space.xs },
  bilanAvoided: { color: colors.primary, fontSize: 14, fontWeight: '700' },

  // Carte d'entrée vers les meilleurs créneaux. Volontairement plus sobre que
  // bilanCard : c'est une porte, pas un insight — elle ne doit pas disputer
  // l'attention aux chiffres de la période affichée.
  slotsCard: {
    backgroundColor: colors.surface,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.md,
    overflow: 'hidden',
  },
  slotsIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,230,118,0.10)',
  },
  slotsText: { flex: 1 },
  slotsTitle: { color: colors.textMain, fontSize: 15, fontWeight: '800' },
  slotsSub: { color: colors.textDimmed, fontSize: 12, marginTop: space.tight },

  // Date button
  // Pilule et non carte : le selecteur de date est un CONTROLE, pas une surface
  // de contenu, et `radius.full` le dit sans avoir a l'ecrire ailleurs.
  dateBtn: {
    backgroundColor: colors.surface,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.full,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    marginBottom: space.lg,
    overflow: 'hidden',
  },
  dateBtnLeft: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dateBtnIcon: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: 'rgba(0,230,118,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  dateBtnText: { color: colors.textMain, fontSize: 15, fontWeight: '600', textTransform: 'capitalize' },

  // Hero card — liquid glass
  heroCard: {
    borderRadius: radius.lg,
    padding: space.xl,
    marginBottom: space.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: stroke.edge,
    ...elevation.raised.shadow,
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
    borderRadius: radius.xs,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  heroLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  heroBefore: { color: colors.textDimmed, fontSize: 11 },
  heroAmount: {
    color: colors.textMain,
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: -2,
    marginBottom: space.sm,
    textAlign: 'center',
  },
  profitToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  profitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
  },
  profitBadgeActive: {
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderColor: stroke.active,
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
  heroSep: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginBottom: space.lg },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatVal: { color: colors.textMain, fontSize: 15, fontWeight: '800', marginBottom: space.tight },
  heroStatLbl: { color: colors.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.4, textAlign: 'center' },
  heroStatDiv: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.08)' },

  // KPI row — liquid glass
  kpiRow: { flexDirection: 'row', gap: space.md, marginBottom: space.lg },
  kpiCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    padding: space.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: stroke.edgeLit,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    ...elevation.resting.shadow,
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
    borderRadius: radius.xs,
  },
  kpiIconWrap: {
    width: 44, height: 44, borderRadius: radius.sm,
    backgroundColor: 'rgba(0,230,118,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  kpiTextBlock: { flex: 1 },
  kpiLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginBottom: space.xs },
  kpiValue: { color: colors.textMain, fontSize: 22, fontWeight: '900' },

  // Platform distribution
  distCard: {
    backgroundColor: colors.surface,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    borderRadius: radius.md,
    padding: space.xl,
    marginBottom: space.lg,
    overflow: 'hidden',
  },
  distTitle: { color: colors.textMain, fontSize: 15, fontWeight: 'bold', marginBottom: space.lg },

  // Stacked combined bar
  stackedBarWrap: { marginBottom: space.xl },
  stackedBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: radius.xs,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: space.sm,
  },
  stackedLegend: { flexDirection: 'row', gap: space.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  legendDot: { width: 8, height: 8, borderRadius: radius.full },
  legendText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },

  distList: { gap: space.lg },
  distItem: { gap: space.sm },
  distItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  distItemLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  distDot: { width: 10, height: 10, borderRadius: radius.full },
  distLabel: { color: colors.textMain, fontSize: 14, fontWeight: '700' },
  distItemRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  distEarning: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  distPctBadge: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
  },
  distPctText: { fontSize: 12, fontWeight: '900' },
  distTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  distFill: { height: 8, borderRadius: radius.xs },

  // Upsell
  upsellCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,230,118,0.06)',
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    marginBottom: space.sm,
  },
  upsellLogo: { width: 24, height: 24, borderRadius: radius.full },
  upsellText: { flex: 1 },
  upsellTitle: { color: colors.textMain, fontSize: 14, fontWeight: 'bold', marginBottom: space.tight },
  upsellSub: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },

  // Calendar modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xl,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    borderRadius: radius.lg,
    padding: space.lg,
    width: '100%',
    overflow: 'hidden',
    ...elevation.raised.shadow,
  },
  calHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: space.sm,
    gap: space.md,
  },
  calMonthBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm,
  },
  calMonthText: { color: colors.textMain, fontSize: 15, fontWeight: '800' },
  yearNavBtn: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
    justifyContent: 'center', alignItems: 'center',
  },
  yearNavText: { color: colors.textMain, fontSize: 18, fontWeight: '800', lineHeight: 20 },
  calNavBtn: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
    justifyContent: 'center', alignItems: 'center',
  },

  // Rouge `danger` de la palette, et non un orange pose a la main hors systeme.
  // Place sous le calendrier : voir le commentaire au point de rendu.
  modalAlertRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: 'rgba(255,77,77,0.10)', borderRadius: radius.sm,
    paddingHorizontal: space.md, paddingVertical: space.sm, marginTop: space.md,
    borderWidth: strokeWidth.control, borderColor: stroke.alert,
  },
  modalAlertText: { color: colors.danger, fontSize: 12, flex: 1, lineHeight: 17 },

  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  // La cellule remplit sa fente : c'est `AnimatedEntrance` qui porte desormais
  // la largeur, sinon l'animation envelopperait une cellule sans lui donner de
  // place et la grille s'effondrerait sur une colonne.
  monthCellSlot: { width: '30%', marginBottom: space.sm },
  monthCell: {
    width: '100%',
    paddingVertical: space.md,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
  },
  monthCellActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  monthCellText: { color: colors.textMain, fontSize: 13, fontWeight: '700' },
  monthCellTextActive: { color: '#06140C', fontWeight: '900' },
});

export default AnalyticsScreen;
