import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Pressable,
  AppState,
  Image,
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
import {
  formatTimeAgo,
  getDayStart,
  toLocalDateKey,
  parseLocalDateKey,
} from '../utils/dateUtils';
import {
  getEffectivePlanTier,
  FREE_THRESHOLDS,
} from '../services/subscriptionService';
import { effectiveFare } from '../services/ridesService';
import { Ride } from '../types/database';
import { computeRideScore, rideScoreColor } from '../utils/qualityScore';
import { withTimeout } from '../utils/withTimeout';
import { cacheRides, getCachedRides } from '../services/offlineService';
import { Skeleton } from '../components/Skeleton';
import ListItemEntrance from '../components/ListItemEntrance';

LocaleConfig.locales['fr'] = {
  monthNames: [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre',
  ],
  monthNamesShort: [
    'Janv.',
    'Févr.',
    'Mars',
    'Avr.',
    'Mai',
    'Juin',
    'Juil.',
    'Août',
    'Sept.',
    'Oct.',
    'Nov.',
    'Déc.',
  ],
  dayNames: [
    'Dimanche',
    'Lundi',
    'Mardi',
    'Mercredi',
    'Jeudi',
    'Vendredi',
    'Samedi',
  ],
  dayNamesShort: ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'],
  today: "Aujourd'hui",
};
LocaleConfig.locales['en'] = {
  monthNames: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  monthNamesShort: [
    'Jan.',
    'Feb.',
    'Mar.',
    'Apr.',
    'May',
    'Jun.',
    'Jul.',
    'Aug.',
    'Sep.',
    'Oct.',
    'Nov.',
    'Dec.',
  ],
  dayNames: [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ],
  dayNamesShort: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  today: 'Today',
};

const PLATFORM_CONFIG: Record<string, { accent: string; label: string }> = {
  UBER: { accent: '#FFFFFF', label: 'UBER' },
  BOLT: { accent: '#34BB78', label: 'Bolt' },
  HEETCH: { accent: '#FF3B80', label: 'Heetch' },
};

const RideCard = React.memo(
  ({
    ride,
    t,
    minHourly,
    minKm,
  }: {
    ride: Ride;
    t: any;
    minHourly: number;
    minKm: number;
  }) => {
    const pc = PLATFORM_CONFIG[ride.platform] || PLATFORM_CONFIG.UBER;
    const isDeclined = ride.status === 'DECLINED';
    const isPending = ride.status === 'PENDING';
    const statusColor = isDeclined
      ? '#FF5252'
      : isPending
      ? '#FFB300'
      : colors.primary;
    const fare = effectiveFare(ride);

    const score = computeRideScore(
      Number(ride.hourly_rate || 0),
      Number(ride.km_rate || 0),
      minHourly,
      minKm,
    );
    const scoreColor =
      score != null ? rideScoreColor(score) : colors.textDimmed;
    // La qualité (score) colore la bordure de la carte et les taux ; le statut
    // garde son chip dédié, c'est la seule information non déductible du reste.
    const accentColor = score != null ? scoreColor : statusColor;

    const formattedTime = new Date(ride.created_at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    // Les taux portent la couleur du score : une seule histoire de couleur par
    // carte. Avant, un score orange cohabitait avec des taux verts — deux verdicts
    // contradictoires sur la même course.
    const rateColor = isDeclined ? colors.textDimmed : accentColor;
    const hasRoute = !!ride.pickup_address || !!ride.destination_address;

    return (
      <View
        style={[
          styles.card,
          isDeclined && styles.cardDeclined,
          // La bordure murmure le verdict (le carré de score, lui, l'énonce) : ça
          // remplace la barre latérale de 4 px, qui répétait la même information
          // sous sa forme la plus convenue.
          score != null && { borderColor: accentColor + '33' },
        ]}
      >
        <View style={styles.cardInner}>
          <View style={styles.cardTopRow}>
            <View style={styles.topLeft}>
              <View
                style={[styles.platformDot, { backgroundColor: pc.accent }]}
              />
              <Text style={styles.platformName}>{pc.label}</Text>
              <Text style={styles.topSep}>·</Text>
              <Text style={styles.timeMain}>{formattedTime}</Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                isDeclined
                  ? styles.statusBadgeDeclined
                  : isPending
                  ? styles.statusBadgePending
                  : styles.statusBadgeAccepted,
              ]}
            >
              <Feather
                name={
                  isDeclined ? 'x-circle' : isPending ? 'clock' : 'check-circle'
                }
                size={11}
                color={statusColor}
              />
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                {t(`history.status.${ride.status}`, {
                  defaultValue: ride.status,
                })}
              </Text>
            </View>
          </View>

          <View style={styles.cardMidRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[styles.fareText, isDeclined && styles.fareDeclined]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {fare.toFixed(2)}€
              </Text>
              <Text style={styles.fareMeta} numberOfLines={1}>
                {ride.duration_min || 0} {t('history.min')} ·{' '}
                {ride.distance_km || 0} {t('history.km')}
                {' · '}
                {formatTimeAgo(ride.created_at, t)}
              </Text>
            </View>
            {score != null && (
              <View style={[styles.scoreBadge, { borderColor: scoreColor }]}>
                <Text style={[styles.scoreValue, { color: scoreColor }]}>
                  {score}
                </Text>
                <Text style={styles.scoreMax}>/100</Text>
              </View>
            )}
          </View>

          {/* Le « pourquoi » du score, au niveau qu'il mérite : ce sont les deux
            chiffres sur lesquels le chauffeur décide. */}
          <View style={styles.rateRow}>
            <Text style={[styles.rateValue, { color: rateColor }]}>
              {Number(ride.hourly_rate || 0).toFixed(0)}
              <Text style={styles.rateUnit}>€/h</Text>
            </Text>
            <View style={styles.rateDivider} />
            <Text style={[styles.rateValue, { color: rateColor }]}>
              {Number(ride.km_rate || 0).toFixed(2)}
              <Text style={styles.rateUnit}>€/km</Text>
            </Text>
          </View>

          {hasRoute && (
            <View style={styles.routeStrip}>
              {/* Trait vertical entre les deux points : la paire se lit comme un
                trajet, plus comme deux lignes de texte muet superposées. */}
              <View style={styles.routeRail}>
                {!!ride.pickup_address && (
                  <View
                    style={[
                      styles.routeDot,
                      {
                        backgroundColor: isDeclined
                          ? colors.textDimmed
                          : colors.primary,
                      },
                    ]}
                  />
                )}
                {!!ride.pickup_address && !!ride.destination_address && (
                  <View style={styles.routeLine} />
                )}
                {!!ride.destination_address && <View style={styles.routeEnd} />}
              </View>
              <View style={styles.routeTexts}>
                {!!ride.pickup_address && (
                  <Text style={styles.routeText} numberOfLines={1}>
                    {ride.pickup_address}
                  </Text>
                )}
                {!!ride.destination_address && (
                  <Text
                    style={[styles.routeText, styles.routeTextDest]}
                    numberOfLines={1}
                  >
                    {ride.destination_address}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>
      </View>
    );
  },
);

type FilterType = 'all' | 'accepted' | 'declined';

const HistoryScreen = () => {
  const { t, i18n } = useTranslation();
  const { user, profile } = useAuth();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<any>();

  const isPremium = getEffectivePlanTier(profile) !== 'free';

  const [resetHour, setResetHour] = useState(0);
  // Défaut aligné sur FREE_THRESHOLDS (1.10 et non 1.2) : le tutoriel et le
  // scanner utilisent cette valeur, un défaut divergent produisait un score
  // différent le temps que les préférences arrivent.
  const [thresholds, setThresholds] = useState<{
    minHourly: number;
    minKm: number;
  }>({
    minHourly: FREE_THRESHOLDS.hourly,
    minKm: FREE_THRESHOLDS.km,
  });

  useEffect(() => {
    LocaleConfig.defaultLocale = i18n.language === 'fr' ? 'fr' : 'en';
  }, [i18n.language]);

  // Re-read day_reset_hour + seuils on focus so a change in Preferences is picked up
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      supabase
        .from('preferences')
        .select('day_reset_hour, min_hourly_rate, min_km_rate')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          const h = data?.day_reset_hour === 4 ? 4 : 0;
          setResetHour(h);
          // Seuils IMPOSÉS en free, comme au scan (DashboardScreen) : sinon le
          // score affiché sur la carte d'une course est calculé sur d'autres
          // seuils que le verdict rendu au moment du scan.
          setThresholds({
            minHourly: isPremium
              ? Number(data?.min_hourly_rate ?? 25) || 25
              : FREE_THRESHOLDS.hourly,
            minKm: isPremium
              ? Number(data?.min_km_rate ?? FREE_THRESHOLDS.km) ||
                FREE_THRESHOLDS.km
              : FREE_THRESHOLDS.km,
          });
          setDateRange({ start: getDayStart(h), end: getDayStart(h) });
        });
    }, [user, isPremium]),
  );

  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  // Date range (Plus only)
  const [dateRange, setDateRange] = useState({
    start: getDayStart(0),
    end: getDayStart(0),
  });
  const [modalVisible, setModalVisible] = useState(false);
  const [selectionStep, setSelectionStep] = useState(0);
  const [tempStart, setTempStart] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(toLocalDateKey(new Date()));
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
      cacheRides(freshRides); // sauvegarde pour mode hors-ligne
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

  useFocusEffect(
    useCallback(() => {
      fetchHistory();
    }, [fetchHistory]),
  );

  // Re-fetch on foreground resume (picks up new day boundary automatically)
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setDateRange({
          start: getDayStart(resetHour),
          end: getDayStart(resetHour),
        });
      }
    });
    return () => sub.remove();
  }, [resetHour]);

  // ── Calendar helpers ─────────────────────────────────────────────────────────

  const handleDayPress = (day: any) => {
    setModalAlert('');
    if (selectionStep === 0) {
      setTempStart(day.dateString);
      setSelectionStep(1);
    } else {
      const start = parseLocalDateKey(tempStart!);
      const end = parseLocalDateKey(day.dateString);
      if (end < start) {
        setTempStart(day.dateString);
        return;
      }
      const diffDays = Math.ceil(
        Math.abs(end.getTime() - start.getTime()) / 86400000,
      );
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
      marks[tempStart] = {
        startingDay: true,
        endingDay: true,
        color: edge,
        textColor: edgeText,
      };
    } else if (dateRange.start && dateRange.end) {
      const startStr = toLocalDateKey(dateRange.start);
      const endStr = toLocalDateKey(dateRange.end);
      if (startStr === endStr) {
        marks[startStr] = {
          startingDay: true,
          endingDay: true,
          color: edge,
          textColor: edgeText,
        };
      } else {
        let curr = parseLocalDateKey(startStr);
        const last = parseLocalDateKey(endStr);
        while (curr <= last) {
          const ds = toLocalDateKey(curr);
          if (ds === startStr)
            marks[ds] = { startingDay: true, color: edge, textColor: edgeText };
          else if (ds === endStr)
            marks[ds] = { endingDay: true, color: edge, textColor: edgeText };
          else marks[ds] = { color: mid, textColor: midText };
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
        <TouchableOpacity
          onPress={() => changeMonth(-1)}
          style={styles.calNavBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="chevron-left" size={18} color={colors.textMain} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.calMonthBtn}
          onPress={() => {
            setPickerYear(d.getFullYear());
            setShowMonthPicker(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('history.changeMonth', 'Changer le mois')}
        >
          <Text style={styles.calMonthText}>
            {locale.monthNames[d.getMonth()]} {d.getFullYear()}
          </Text>
          <Feather
            name="chevron-down"
            size={13}
            color={colors.primary}
            style={{ marginLeft: 6 }}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => changeMonth(1)}
          style={styles.calNavBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="chevron-right" size={18} color={colors.textMain} />
        </TouchableOpacity>
      </View>
    );
  };

  const getHeaderDateText = () => {
    const isFr = i18n.language === 'fr';
    const fmt = (d: Date) =>
      d.toLocaleDateString(isFr ? 'fr-FR' : 'en-US', {
        day: 'numeric',
        month: 'short',
      });
    if (dateRange.start.toDateString() === dateRange.end.toDateString())
      return fmt(dateRange.start);
    return isFr
      ? `Du ${fmt(dateRange.start)} au ${fmt(dateRange.end)}`
      : `${fmt(dateRange.start)} – ${fmt(dateRange.end)}`;
  };

  // ── Computed ────────────────────────────────────────────────────────────────

  const accepted = rides.filter(r => r.status === 'ACCEPTED').length;
  const declined = rides.filter(r => r.status === 'DECLINED').length;
  const acceptRate =
    rides.length > 0 ? Math.round((accepted / rides.length) * 100) : 0;
  const dailyTotal = rides
    .filter(r => r.status === 'ACCEPTED')
    .reduce((sum, r) => sum + effectiveFare(r), 0);

  const filteredRides = useMemo(
    () =>
      rides.filter(r => {
        if (filter === 'accepted') return r.status === 'ACCEPTED';
        if (filter === 'declined') return r.status === 'DECLINED';
        return true;
      }),
    [rides, filter],
  );

  const renderRideCard = useCallback(
    ({ item, index }: { item: Ride; index: number }) => (
      <ListItemEntrance index={index}>
        <RideCard
          ride={item}
          t={t}
          minHourly={thresholds.minHourly}
          minKm={thresholds.minKm}
        />
      </ListItemEntrance>
    ),
    [t, thresholds],
  );

  const todayDate = new Date().toLocaleDateString(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
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
        <TouchableOpacity
          style={styles.dateBtn}
          onPress={() => {
            setSelectionStep(0);
            setTempStart(null);
            setCurrentMonth(toLocalDateKey(dateRange.start));
            setModalVisible(true);
          }}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t('history.selectDates', 'Select date range')}
        >
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
          <Image
            source={require('../assets/strive-logo.png')}
            style={styles.upgradeBannerLogo}
          />
          <Text style={styles.upgradeBannerText}>
            {t(
              'history.upgradeForHistory',
              'Passez Plus pour voir tout votre historique',
            )}
          </Text>
          <Feather name="chevron-right" size={14} color={colors.primary} />
        </TouchableOpacity>
      )}

      {/* ── ERROR STATE ── */}
      {fetchError && (
        <View style={styles.errorCard}>
          <Feather name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>
            {t('errors.loadFailed', 'Erreur de chargement')}
          </Text>
          <TouchableOpacity onPress={fetchHistory}>
            <Text style={styles.errorRetry}>
              {t('errors.retry', 'Réessayer')}
            </Text>
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
              <Text style={styles.heroLabel}>
                {t('history.earnings', 'Gains')}
              </Text>
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
              <Text
                style={styles.acceptValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {acceptRate}%
              </Text>
              <Text style={styles.acceptLabel} numberOfLines={1}>
                {t('history.acceptRate')}
              </Text>
              <View style={styles.acceptBar}>
                <View
                  style={[
                    styles.acceptFill,
                    { width: `${acceptRate}%` as any },
                  ]}
                />
              </View>
            </View>
          </View>

          <View style={styles.heroSep} />

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatVal}>{rides.length}</Text>
              <Text style={styles.heroStatLbl} numberOfLines={2}>
                {t('history.scanned')}
              </Text>
            </View>
            <View style={styles.heroStatDiv} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatVal, { color: '#00E676' }]}>
                {accepted}
              </Text>
              <Text style={styles.heroStatLbl} numberOfLines={2}>
                {t('history.status.ACCEPTED')}
              </Text>
            </View>
            <View style={styles.heroStatDiv} />
            <View style={styles.heroStat}>
              <Text
                style={[
                  styles.heroStatVal,
                  declined > 0 ? { color: '#FF5252' } : {},
                ]}
              >
                {declined}
              </Text>
              <Text style={styles.heroStatLbl} numberOfLines={2}>
                {t('history.status.DECLINED')}
              </Text>
            </View>
          </View>
        </View>
      </SafeGradient>

      {/* ── FILTER TABS ── */}
      <View style={styles.filterRow}>
        {(['all', 'accepted', 'declined'] as FilterType[]).map(f => {
          const isActive = filter === f;
          const tabStyle = isActive
            ? f === 'accepted'
              ? styles.filterTabActiveAccepted
              : f === 'declined'
              ? styles.filterTabActiveDeclined
              : styles.filterTabActive
            : null;
          const textStyle = isActive
            ? f === 'accepted'
              ? styles.filterTabTextActiveAccepted
              : f === 'declined'
              ? styles.filterTabTextActiveDeclined
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
                <View
                  style={[
                    styles.filterDot,
                    {
                      backgroundColor: f === 'accepted' ? '#00E676' : '#FF5252',
                    },
                  ]}
                />
              )}
              <Text style={[styles.filterTabText, textStyle]}>
                {f === 'all'
                  ? t('history.filterAll', { count: rides.length })
                  : f === 'accepted'
                  ? `✓ ${accepted}`
                  : `✕ ${declined}`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── LOADING / EMPTY ── */}
      {loading && (
        <View style={styles.skeletonList}>
          {[0, 1, 2, 3, 4].map(i => (
            <View key={i} style={styles.skeletonRow}>
              <Skeleton width={44} height={44} radius={12} />
              <View style={styles.skeletonRowText}>
                <Skeleton width="60%" height={14} />
                <Skeleton width="38%" height={12} />
              </View>
              <Skeleton width={58} height={22} radius={8} />
            </View>
          ))}
        </View>
      )}
      {!loading && filteredRides.length === 0 && (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <MaterialCommunityIcons
              name="radar"
              size={32}
              color={colors.textDimmed}
            />
          </View>
          <Text style={styles.emptyTitle}>{t('history.empty')}</Text>
          <Text style={styles.emptyHint}>
            {t('history.emptyHint', 'Vos scans apparaîtront ici.')}
          </Text>
          <TouchableOpacity
            style={styles.emptyCta}
            onPress={() => navigation.navigate('Dashboard' as never)}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons
              name="line-scan"
              size={16}
              color={colors.background}
            />
            <Text style={styles.emptyCtaText}>
              {t('history.emptyCta', 'Lancer un scan')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={loading ? [] : filteredRides}
        keyExtractor={item => item.id}
        renderItem={renderRideCard}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{
          paddingBottom: tabBarHeight + 16,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
      />

      {/* ── CALENDAR MODAL (Plus only) ── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setModalVisible(false);
          setModalAlert('');
        }}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => {
            setModalVisible(false);
            setModalAlert('');
          }}
        >
          <Pressable
            style={styles.modalCard}
            onPress={e => e.stopPropagation()}
          >
            {showMonthPicker ? (
              <View>
                <View style={styles.calHeaderRow}>
                  <TouchableOpacity
                    onPress={() => setPickerYear(y => y - 1)}
                    style={styles.yearNavBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.yearNavText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.calMonthText}>{pickerYear}</Text>
                  <TouchableOpacity
                    onPress={() => setPickerYear(y => y + 1)}
                    style={styles.yearNavBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.yearNavText}>+</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.monthGrid}>
                  {LocaleConfig.locales[
                    i18n.language === 'fr' ? 'fr' : 'en'
                  ].monthNamesShort.map((m: string, idx: number) => {
                    const active =
                      parseInt(currentMonth.split('-')[1]) - 1 === idx &&
                      pickerYear === parseInt(currentMonth.split('-')[0]);
                    return (
                      <TouchableOpacity
                        key={idx}
                        style={[
                          styles.monthCell,
                          active && styles.monthCellActive,
                        ]}
                        onPress={() => {
                          setCurrentMonth(
                            `${pickerYear}-${String(idx + 1).padStart(
                              2,
                              '0',
                            )}-01`,
                          );
                          setShowMonthPicker(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.monthCellText,
                            active && styles.monthCellTextActive,
                          ]}
                        >
                          {m}
                        </Text>
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
                {/* Alerte conditionnelle, placee APRES le calendrier : au-dessus,
                    son apparition poussait toute la grille vers le bas, en pleine
                    selection et sous le doigt. Ici la grille ne bouge pas. */}
                {modalAlert ? (
                  <View style={styles.modalAlertRow}>
                    <Feather
                      name="alert-circle"
                      size={14}
                      color={colors.danger}
                    />
                    <Text style={styles.modalAlertText}>{modalAlert}</Text>
                  </View>
                ) : null}
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
  headerSub: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
    textTransform: 'capitalize',
  },

  // Date selector
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  dateBtnLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateBtnIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: 'rgba(0,230,118,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateBtnText: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'capitalize',
  },

  // Upgrade banner
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,230,118,0.06)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.15)',
  },
  upgradeBannerLogo: { width: 18, height: 18, borderRadius: 9 },
  upgradeBannerText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },

  // Error
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,77,77,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.2)',
    padding: 14,
    marginBottom: 12,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 13, fontWeight: '500' },
  errorRetry: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  // Hero
  heroCard: {
    borderRadius: 24,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.12)',
    overflow: 'hidden',
    backgroundColor: '#0A150E',
  },
  heroContent: {
    padding: 20,
  },
  heroMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 20,
    gap: 12,
  },
  heroLeft: { flex: 1, minWidth: 0 },
  heroLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  heroAmount: {
    color: colors.textMain,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
  },
  acceptBlock: { alignItems: 'flex-end', flexShrink: 0, maxWidth: 100 },
  acceptValue: { color: colors.primary, fontSize: 28, fontWeight: '900' },
  acceptLabel: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  acceptBar: {
    width: 72,
    height: 4,
    backgroundColor: 'rgba(0,230,118,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  acceptFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  heroSep: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginBottom: 16,
  },
  heroStats: { flexDirection: 'row' },
  heroStat: { flex: 1, alignItems: 'center', gap: 4 },
  heroStatVal: { color: colors.textMain, fontSize: 20, fontWeight: '800' },
  heroStatLbl: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  heroStatDiv: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 4,
  },

  // Filter tabs
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  filterTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  filterTabActive: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.15)',
  },
  filterTabActiveAccepted: {
    backgroundColor: 'rgba(0,230,118,0.1)',
    borderColor: 'rgba(0,230,118,0.3)',
  },
  filterTabActiveDeclined: {
    backgroundColor: 'rgba(255,82,82,0.1)',
    borderColor: 'rgba(255,82,82,0.3)',
  },
  filterDot: { width: 6, height: 6, borderRadius: 3 },
  filterTabText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  filterTabTextActive: { color: colors.textMain },
  filterTabTextActiveAccepted: { color: '#00E676' },
  filterTabTextActiveDeclined: { color: '#FF5252' },

  // Ride card
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  // Course refusée : fond assombri (sans opacité) pour la repérer dans la liste.
  cardDeclined: { backgroundColor: '#0E1613' },
  cardInner: { padding: 14 },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  platformDot: { width: 7, height: 7, borderRadius: 4 },
  platformName: {
    color: colors.textMain,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  topSep: { color: colors.textDimmed, fontSize: 12, fontWeight: '700' },

  // Taux : le deuxième niveau de lecture, coloré par le score.
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  rateValue: { flex: 1, fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  rateUnit: { fontSize: 12, fontWeight: '700', letterSpacing: 0 },
  rateDivider: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginRight: 14,
  },

  // Trajet : rail à gauche, adresses à droite.
  routeStrip: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 11,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  routeRail: { alignItems: 'center', paddingTop: 5, paddingLeft: 1 },
  routeDot: { width: 7, height: 7, borderRadius: 4 },
  routeLine: {
    width: 1,
    flex: 1,
    minHeight: 11,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 2,
  },
  routeEnd: {
    width: 5,
    height: 5,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.textDimmed,
  },
  routeTexts: { flex: 1, gap: 4, minWidth: 0 },
  routeText: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  routeTextDest: { color: colors.textDimmed },
  timeMain: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  cardMidRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  fareText: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  fareMeta: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  scoreBadge: {
    width: 60,
    height: 60,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  scoreValue: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  scoreMax: {
    color: colors.textDimmed,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: -1,
  },
  fareDeclined: {
    color: colors.textDimmed,
    textDecorationLine: 'line-through',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusBadgeAccepted: {
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderColor: 'rgba(0,230,118,0.22)',
  },
  statusBadgeDeclined: {
    backgroundColor: 'rgba(255,82,82,0.07)',
    borderColor: 'rgba(255,82,82,0.18)',
  },
  statusBadgePending: {
    backgroundColor: 'rgba(255,179,0,0.08)',
    borderColor: 'rgba(255,179,0,0.22)',
  },
  statusBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  // Loading skeleton
  skeletonList: { gap: 12, marginTop: 4 },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  skeletonRowText: { flex: 1, gap: 8 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyHint: {
    color: colors.textDimmed,
    fontSize: 12,
    textAlign: 'center',
    marginTop: -4,
  },
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
    width: 72,
    height: 72,
    backgroundColor: colors.surface,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.12)',
  },
  emptyTitle: { color: colors.textMuted, fontSize: 14 },

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
    padding: 18,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle: { color: colors.textMain, fontSize: 16, fontWeight: '800' },
  modalClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalPresets: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  presetChip: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  presetChipText: {
    color: colors.textMain,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  // Rouge `danger` de la palette, et non un orange pose a la main hors systeme.
  // Place sous le calendrier : voir le commentaire au point de rendu.
  modalAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,77,77,0.10)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.22)',
  },
  modalAlertText: {
    color: colors.danger,
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },

  calHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 10,
    gap: 14,
  },
  calMonthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.18)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  calMonthText: { color: colors.textMain, fontSize: 15, fontWeight: '800' },
  yearNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  yearNavText: {
    color: colors.textMain,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 20,
  },
  calNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
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
