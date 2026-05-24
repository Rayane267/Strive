import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SafeGradient from '../components/SafeGradient';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';
import { formatTimeAgo, getDayStart } from '../utils/dateUtils';
import { getEffectivePlanTier } from '../services/subscriptionService';
import { effectiveFare } from '../services/ridesService';
import { Ride } from '../types/database';
import { withTimeout } from '../utils/withTimeout';
import { cacheRides, getCachedRides } from '../services/offlineService';
import BrandLoader from '../components/BrandLoader';

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

const PLATFORM_CONFIG: Record<string, { accent: string; label: string }> = {
  UBER:   { accent: '#FFFFFF', label: 'UBER'   },
  BOLT:   { accent: '#34BB78', label: 'Bolt'   },
  HEETCH: { accent: '#FF3B80', label: 'Heetch' },
};

const RideCard = React.memo(({ ride, t }: { ride: Ride; t: any }) => {
  const pc = PLATFORM_CONFIG[ride.platform] || PLATFORM_CONFIG.UBER;
  const isDeclined = ride.status === 'DECLINED';
  const isPending = ride.status === 'PENDING';
  const accentColor = isDeclined ? '#FF5252' : isPending ? '#FFB300' : colors.primary;
  const fare = effectiveFare(ride);
  const fareIsEstimated = ride.fare_final == null;

  const formattedTime = new Date(ride.created_at).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  return (
    <View style={styles.card}>
      <View style={[styles.cardAccent, { backgroundColor: accentColor }]} />
      <View style={styles.cardInner}>
        <View style={styles.cardTopRow}>
          <View style={[styles.platformChip, { borderColor: accentColor + '50' }]}>
            <View style={[styles.platformDot, { backgroundColor: accentColor }]} />
            <Text style={styles.platformChipText}>{pc.label}</Text>
          </View>
          <View style={styles.timeBlock}>
            <Text style={styles.timeMain}>{formattedTime}</Text>
            <Text style={styles.timeAgo}>{formatTimeAgo(ride.created_at, t)}</Text>
          </View>
        </View>

        <View style={styles.cardMidRow}>
          <View>
            <Text style={[styles.fareText, isDeclined && styles.fareDeclined]}>
              {fare.toFixed(2)}€
            </Text>
            {fareIsEstimated && !isDeclined && (
              <Text style={styles.fareEst}>{t('dashboard.estimated', 'est.')}</Text>
            )}
          </View>
          <View style={[
            styles.statusBadge,
            isDeclined ? styles.statusBadgeDeclined : isPending ? styles.statusBadgePending : styles.statusBadgeAccepted,
          ]}>
            <Feather
              name={isDeclined ? 'x-circle' : isPending ? 'clock' : 'check-circle'}
              size={12}
              color={isDeclined ? '#FF5252' : isPending ? '#FFB300' : '#00E676'}
            />
            <Text style={[
              styles.statusBadgeText,
              { color: isDeclined ? '#FF5252' : isPending ? '#FFB300' : '#00E676' },
            ]}>
              {t(`history.status.${ride.status}`, { defaultValue: ride.status })}
            </Text>
          </View>
        </View>

        <View style={styles.metricsStrip}>
          <View style={styles.metricPair}>
            <Feather name="clock" size={11} color={colors.textDimmed} />
            <Text style={styles.metricText}>{ride.duration_min || 0} {t('history.min')}</Text>
          </View>
          <View style={styles.metricSep} />
          <View style={styles.metricPair}>
            <Feather name="map-pin" size={11} color={colors.textDimmed} />
            <Text style={styles.metricText}>{ride.distance_km || 0} {t('history.km')}</Text>
          </View>
          <View style={styles.metricSep} />
          <View style={styles.metricPair}>
            <Feather name="trending-up" size={11} color={isDeclined ? colors.textDimmed : colors.primary} />
            <Text style={[styles.metricText, !isDeclined && styles.metricHighlight]}>
              {Number(ride.hourly_rate || 0).toFixed(0)}€/h
            </Text>
          </View>
          <View style={styles.metricSep} />
          <View style={styles.metricPair}>
            <MaterialCommunityIcons name="map-marker-distance" size={11} color={isDeclined ? colors.textDimmed : colors.primary} />
            <Text style={[styles.metricText, !isDeclined && styles.metricHighlight]}>
              {Number(ride.km_rate || 0).toFixed(2)}€/km
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
});

type FilterType = 'all' | 'accepted' | 'declined';

const HistoryScreen = () => {
  const { t, i18n } = useTranslation();
  const { user, profile } = useAuth();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<any>();

  const isPremium = getEffectivePlanTier(profile) !== 'free';

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

  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  // Date range (Plus only)
  const [dateRange, setDateRange] = useState({ start: getDayStart(0), end: getDayStart(0) });
  const [modalVisible, setModalVisible] = useState(false);
  const [selectionStep, setSelectionStep] = useState(0);
  const [tempStart, setTempStart] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().split('T')[0]);
  const [modalAlert, setModalAlert] = useState('');
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());

  const fetchingRef = useRef(false);
  const fetchHistory = useCallback(async () => {
    if (!user || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      setLoading(true);
      setFetchError(false);

      const rangeStart = new Date(dateRange.start);
      rangeStart.setHours(resetHour, 0, 0, 0);
      const rangeEnd = new Date(dateRange.end);
      rangeEnd.setDate(rangeEnd.getDate() + 1);
      rangeEnd.setHours(resetHour, 0, 0, 0);

      const { data, error } = await withTimeout(
        Promise.resolve(
          supabase
            .from('rides')
            .select('*')
            .eq('user_id', user.id)
            .gte('created_at', rangeStart.toISOString())
            .lte('created_at', rangeEnd.toISOString())
            .order('created_at', { ascending: false }),
        ),
        10_000,
      );

      if (error) throw error;
      const freshRides = (data ?? []) as Ride[];
      setRides(freshRides);
      cacheRides(freshRides);  // sauvegarde pour mode hors-ligne
    } catch (e) {
      __DEV__ && console.warn('[History] fetch KO, fallback cache', e);
      // Fallback cache local si réseau/Supabase KO
      const cached = await getCachedRides();
      if (cached && cached.length > 0) {
        setRides(cached);
        setFetchError(false);
      } else {
        setFetchError(true);
      }
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [user, dateRange, resetHour]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  }, [fetchHistory]);

  useFocusEffect(useCallback(() => { fetchHistory(); }, [fetchHistory]));

  // ── Calendar helpers ─────────────────────────────────────────────────────────

  const handleDayPress = (day: any) => {
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
          if (ds === startStr)     marks[ds] = { startingDay: true, color: edge, textColor: edgeText };
          else if (ds === endStr)  marks[ds] = { endingDay: true, color: edge, textColor: edgeText };
          else                     marks[ds] = { color: mid, textColor: midText };
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
        <TouchableOpacity
          style={styles.calMonthBtn}
          onPress={() => { setPickerYear(d.getFullYear()); setShowMonthPicker(true); }}
          accessibilityRole="button"
          accessibilityLabel={t('history.changeMonth', 'Changer le mois')}
        >
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
    const isFr = i18n.language === 'fr';
    const fmt = (d: Date) => d.toLocaleDateString(isFr ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' });
    if (dateRange.start.toDateString() === dateRange.end.toDateString()) return fmt(dateRange.start);
    return isFr ? `Du ${fmt(dateRange.start)} au ${fmt(dateRange.end)}` : `${fmt(dateRange.start)} – ${fmt(dateRange.end)}`;
  };

  // ── Computed ────────────────────────────────────────────────────────────────

  const accepted = rides.filter(r => r.status === 'ACCEPTED').length;
  const declined = rides.filter(r => r.status === 'DECLINED').length;
  const acceptRate = rides.length > 0 ? Math.round((accepted / rides.length) * 100) : 0;
  const dailyTotal = rides
    .filter(r => r.status === 'ACCEPTED')
    .reduce((sum, r) => sum + effectiveFare(r), 0);

  const filteredRides = useMemo(() => rides.filter(r => {
    if (filter === 'accepted') return r.status === 'ACCEPTED';
    if (filter === 'declined') return r.status === 'DECLINED';
    return true;
  }), [rides, filter]);

  const renderRideCard = useCallback(({ item }: { item: Ride }) => (
    <RideCard ride={item} t={t} />
  ), [t]);

  const todayDate = new Date().toLocaleDateString(i18n.language, {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const listHeader = (
    <View>
      {/* ── HEADER ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('history.title')}</Text>
        <Text style={styles.headerSub}>{todayDate}</Text>
      </View>

      {/* ── DATE SELECTOR (Plus only) ── */}
      {isPremium ? (
        <TouchableOpacity style={styles.dateBtn} onPress={() => {
          setSelectionStep(0);
          setTempStart(null);
          setCurrentMonth(dateRange.start.toISOString().split('T')[0]);
          setModalVisible(true);
        }} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={t('history.selectDates', 'Select date range')}>
          <View style={styles.dateBtnLeft}>
            <View style={styles.dateBtnIcon}>
              <Feather name="calendar" size={16} color={colors.primary} />
            </View>
            <Text style={styles.dateBtnText}>{getHeaderDateText()}</Text>
          </View>
          <Feather name="chevron-down" size={18} color={colors.textDimmed} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.upgradeBanner}
          onPress={() => navigation.navigate('SubscriptionScreen')}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons name="crown" size={16} color={colors.primary} />
          <Text style={styles.upgradeBannerText}>{t('history.upgradeForHistory', 'Passez Plus pour voir tout votre historique')}</Text>
          <Feather name="chevron-right" size={14} color={colors.primary} />
        </TouchableOpacity>
      )}

      {/* ── ERROR STATE ── */}
      {fetchError && (
        <View style={styles.errorCard}>
          <Feather name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{t('errors.loadFailed', 'Erreur de chargement')}</Text>
          <TouchableOpacity onPress={fetchHistory}>
            <Text style={styles.errorRetry}>{t('errors.retry', 'Réessayer')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── HERO CARD ── */}
      <SafeGradient
        colors={['#0F2D1F', '#0A150E']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <View style={styles.heroContent}>
        <View style={styles.heroMain}>
          <View style={styles.heroLeft}>
            <Text style={styles.heroLabel}>{t('history.earnings', 'Gains')}</Text>
            <Text
              style={styles.heroAmount}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {dailyTotal.toFixed(2)}€
            </Text>
          </View>
          <View style={styles.acceptBlock}>
            <Text style={styles.acceptValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{acceptRate}%</Text>
            <Text style={styles.acceptLabel} numberOfLines={1}>{t('history.acceptRate')}</Text>
            <View style={styles.acceptBar}>
              <View style={[styles.acceptFill, { width: `${acceptRate}%` as any }]} />
            </View>
          </View>
        </View>

        <View style={styles.heroSep} />

        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatVal}>{rides.length}</Text>
            <Text style={styles.heroStatLbl} numberOfLines={2}>{t('history.scanned')}</Text>
          </View>
          <View style={styles.heroStatDiv} />
          <View style={styles.heroStat}>
            <Text style={[styles.heroStatVal, { color: '#00E676' }]}>{accepted}</Text>
            <Text style={styles.heroStatLbl} numberOfLines={2}>{t('history.status.ACCEPTED')}</Text>
          </View>
          <View style={styles.heroStatDiv} />
          <View style={styles.heroStat}>
            <Text style={[styles.heroStatVal, declined > 0 ? { color: '#FF5252' } : {}]}>{declined}</Text>
            <Text style={styles.heroStatLbl} numberOfLines={2}>{t('history.status.DECLINED')}</Text>
          </View>
        </View>
        </View>
      </SafeGradient>

      {/* ── FILTER TABS ── */}
      <View style={styles.filterRow}>
        {(['all', 'accepted', 'declined'] as FilterType[]).map(f => {
          const isActive = filter === f;
          const tabStyle = isActive
            ? f === 'accepted' ? styles.filterTabActiveAccepted
            : f === 'declined' ? styles.filterTabActiveDeclined
            : styles.filterTabActive
            : null;
          const textStyle = isActive
            ? f === 'accepted' ? styles.filterTabTextActiveAccepted
            : f === 'declined' ? styles.filterTabTextActiveDeclined
            : styles.filterTabTextActive
            : null;
          return (
            <TouchableOpacity
              key={f}
              style={[styles.filterTab, tabStyle]}
              onPress={() => setFilter(f)}
              activeOpacity={0.7}
            >
              {isActive && f !== 'all' && (
                <View style={[styles.filterDot, { backgroundColor: f === 'accepted' ? '#00E676' : '#FF5252' }]} />
              )}
              <Text style={[styles.filterTabText, textStyle]}>
                {f === 'all'
                  ? t('history.filterAll', { count: rides.length })
                  : f === 'accepted' ? `✓ ${accepted}`
                  : `✕ ${declined}`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── LOADING / EMPTY ── */}
      {loading && (
        <BrandLoader style={{ marginTop: 40 }} />
      )}
      {!loading && filteredRides.length === 0 && (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <MaterialCommunityIcons name="radar" size={32} color={colors.textDimmed} />
          </View>
          <Text style={styles.emptyTitle}>{t('history.empty')}</Text>
          <Text style={styles.emptyHint}>{t('history.emptyHint', 'Vos scans apparaîtront ici.')}</Text>
          <TouchableOpacity
            style={styles.emptyCta}
            onPress={() => navigation.navigate('Dashboard' as never)}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="line-scan" size={16} color={colors.background} />
            <Text style={styles.emptyCtaText}>{t('history.emptyCta', 'Lancer un scan')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={loading ? [] : filteredRides}
        keyExtractor={(item) => item.id}
        renderItem={renderRideCard}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingBottom: tabBarHeight + 16, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
      />

      {/* ── CALENDAR MODAL (Plus only) ── */}
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
                  onMonthChange={(m: any) => setCurrentMonth(m.dateString)}
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

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20 },

  header: { paddingTop: 8, marginBottom: 16 },
  headerTitle: { color: colors.textMain, fontSize: 28, fontWeight: '900' },
  headerSub: { color: colors.textMuted, fontSize: 13, marginTop: 4, textTransform: 'capitalize' },

  // Date selector
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: 14,
    paddingVertical: 13, paddingHorizontal: 16, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  dateBtnLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateBtnIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: 'rgba(0,230,118,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  dateBtnText: { color: colors.textMain, fontSize: 15, fontWeight: '600', textTransform: 'capitalize' },

  // Upgrade banner
  upgradeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(0,230,118,0.06)',
    borderRadius: 12, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.15)',
  },
  upgradeBannerText: { flex: 1, color: colors.textMuted, fontSize: 12, fontWeight: '500' },

  // Error
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,77,77,0.08)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,77,77,0.2)',
    padding: 14, marginBottom: 12,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 13, fontWeight: '500' },
  errorRetry: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  // Hero
  heroCard: {
    borderRadius: 24, marginBottom: 18,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.12)',
    overflow: 'hidden',
    backgroundColor: '#0A150E',
  },
  heroContent: {
    padding: 20,
  },
  heroMain: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', marginBottom: 20, gap: 12,
  },
  heroLeft: { flex: 1, minWidth: 0 },
  heroLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 },
  heroAmount: { color: colors.textMain, fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  acceptBlock: { alignItems: 'flex-end', flexShrink: 0, maxWidth: 100 },
  acceptValue: { color: colors.primary, fontSize: 28, fontWeight: '900' },
  acceptLabel: { color: colors.textDimmed, fontSize: 11, fontWeight: '600', letterSpacing: 0.3, marginBottom: 8 },
  acceptBar: { width: 72, height: 4, backgroundColor: 'rgba(0,230,118,0.15)', borderRadius: 2, overflow: 'hidden' },
  acceptFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  heroSep: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginBottom: 16 },
  heroStats: { flexDirection: 'row' },
  heroStat: { flex: 1, alignItems: 'center', gap: 4 },
  heroStatVal: { color: colors.textMain, fontSize: 20, fontWeight: '800' },
  heroStatLbl: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center' },
  heroStatDiv: { width: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 4 },

  // Filter tabs
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  filterTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  filterTabActive: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' },
  filterTabActiveAccepted: { backgroundColor: 'rgba(0,230,118,0.1)', borderColor: 'rgba(0,230,118,0.3)' },
  filterTabActiveDeclined: { backgroundColor: 'rgba(255,82,82,0.1)', borderColor: 'rgba(255,82,82,0.3)' },
  filterDot: { width: 6, height: 6, borderRadius: 3 },
  filterTabText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  filterTabTextActive: { color: colors.textMain },
  filterTabTextActiveAccepted: { color: '#00E676' },
  filterTabTextActiveDeclined: { color: '#FF5252' },

  // Ride card
  card: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderRadius: 16, marginBottom: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 6,
  },
  cardAccent: { width: 4 },
  cardInner: { flex: 1, padding: 14 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  platformChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9,
    borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  platformDot: { width: 7, height: 7, borderRadius: 4 },
  platformChipText: { color: colors.textMain, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  timeBlock: { alignItems: 'flex-end' },
  timeMain: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  timeAgo: { color: colors.textDimmed, fontSize: 11, marginTop: 2 },
  cardMidRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  fareText: { color: '#FFFFFF', fontSize: 34, fontWeight: '900', letterSpacing: -0.5 },
  fareDeclined: { color: colors.textDimmed, textDecorationLine: 'line-through' },
  fareEst: { color: colors.textDimmed, fontSize: 10, fontWeight: '600', marginTop: 2 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1,
  },
  statusBadgeAccepted: { backgroundColor: 'rgba(0,230,118,0.08)', borderColor: 'rgba(0,230,118,0.22)' },
  statusBadgeDeclined: { backgroundColor: 'rgba(255,82,82,0.07)', borderColor: 'rgba(255,82,82,0.18)' },
  statusBadgePending:  { backgroundColor: 'rgba(255,179,0,0.08)', borderColor: 'rgba(255,179,0,0.22)' },
  statusBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  metricsStrip: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 11, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)',
  },
  metricPair: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  metricText: { color: colors.textDimmed, fontSize: 11, fontWeight: '600' },
  metricHighlight: { color: colors.primary },
  metricSep: { width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 2 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyHint: { color: colors.textDimmed, fontSize: 12, textAlign: 'center', marginTop: -4 },
  emptyCta: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  emptyCtaText: { color: colors.background, fontWeight: '700', fontSize: 13 },
  emptyIconWrap: {
    width: 72, height: 72, backgroundColor: colors.surface, borderRadius: 36,
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.12)',
  },
  emptyTitle: { color: colors.textMuted, fontSize: 14 },

  // Calendar modal
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface, borderRadius: 22, padding: 18, width: '100%',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 16,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle: { color: colors.textMain, fontSize: 16, fontWeight: '800' },
  modalClose: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalPresets: {
    flexDirection: 'row', gap: 8, marginBottom: 12,
  },
  presetChip: {
    flex: 1,
    paddingVertical: 9, paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  presetChipText: {
    color: colors.textMain, fontSize: 11, fontWeight: '700',
    textAlign: 'center',
  },
  modalAlertRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,202,40,0.1)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,202,40,0.2)',
  },
  modalAlertText: { color: '#FFCA28', fontSize: 12, flex: 1, lineHeight: 17 },

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

export default HistoryScreen;
