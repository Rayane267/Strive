import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../theme/colors';
import { supabase } from '../services/supabase';
import { fetchRides, updateRideStatus, updateRideFare, createRide, effectiveFare } from '../services/ridesService';
import { fetchParserConfig } from '../services/parserConfigService';
import { useTranslation } from 'react-i18next';
import { Ride } from '../types/database';
import { formatTimeAgo, formatDuration, getDayStart } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';
import { PremiumBanner } from '../components/PremiumBanner';
import { getPlanTier, getPlanLimits, getRemainingScans } from '../services/subscriptionService';
import { scannerService } from '../services/scanner';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_KEY } from '@env';
import { maybePromptRating, markRatingPrompted, openStoreForRating } from '../utils/ratingPrompt';
import { calculateRouteDuration } from '../services/tomtomService';
import { hapticSuccess, hapticError, hapticMedium, hapticHeavy } from '../utils/haptics';
import { cacheRides } from '../services/offlineService';
import { registerPushToken, setupNotificationListeners, shouldAlertLowCredits } from '../services/notificationService';
import AnimatedEntrance from '../components/AnimatedEntrance';

const platformBackgrounds: Record<string, any> = {
  UBER:   require('../images/uber-bg.png'),
  BOLT:   require('../images/bolt-bg.png'),
  HEETCH: require('../images/heetch-bg.png'),
};

const PLATFORM_COLORS: Record<string, string> = {
  UBER:   '#FFFFFF',
  BOLT:   '#34BB78',
  HEETCH: '#FF3B80',
};

const DashboardScreen = () => {
  const { t, i18n } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<any>();

  const [rides, setRides] = useState<Ride[]>([]);
  const [stats, setStats] = useState({ earnings: '0', avgRate: '0', scans: 0 });
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState({ min_hourly_rate: 25, min_km_rate: 1.2 });

  const tier = getPlanTier(profile?.subscription_tier);
  const { dailyScans } = getPlanLimits(tier);
  const extraCredits = profile?.extra_scan_credits ?? 0;
  const remaining = getRemainingScans(tier, rides.length, extraCredits);
  const canScan = remaining === null || remaining > 0;

  const [isOnline, setIsOnline] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [priceModal, setPriceModal] = useState<{ rideId: string; input: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<string | null>(null); // rideId awaiting price confirmation
  const [ratingModal, setRatingModal] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Push notifications ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    registerPushToken(user.id);
    const cleanup = setupNotificationListeners();
    return cleanup;
  }, [user?.id]);

  // ── Config scanner (edge function Gemini + remote config OCR) ────────────
  useEffect(() => {
    scannerService.setGeminiConfig(
      `${PUBLIC_SUPABASE_URL}/functions/v1/gemini-proxy`,
      PUBLIC_SUPABASE_KEY,
    );
    fetchParserConfig().then(config => {
      if (config) scannerService.setParserConfig(config);
    });
  }, []);

  // ── Scanner listeners ─────────────────────────────────────────────────────
  useEffect(() => {
    const subResult = scannerService.onScanResult(async (result) => {
      if (!user?.id) return;
      // 1. Calculer les metriques
      const durationMin = result.durationMin ?? Math.round(result.distanceKm / 25 * 60);
      const hourlyRate = result.fare / (durationMin / 60);
      const kmRate = result.fare / result.distanceKm;

      // 2. Verdict vs preferences (0=rouge, 1=orange, 2=vert)
      const hrOk = hourlyRate >= preferences.min_hourly_rate;
      const kmOk = kmRate >= preferences.min_km_rate;
      const level = hrOk && kmOk ? 2 : (hrOk || kmOk) ? 1 : 0;
      scannerService.showVerdict(level);
      hapticHeavy(); // Feedback haptique à chaque scan reçu

      // 3. Logger dans Supabase
      try {
        const newRide = await createRide({
          userId: user.id,
          platform: result.platform,
          fare: result.fare,
          distanceKm: result.distanceKm,
          durationMin,
          hourlyRate,
          kmRate,
        });
        setRides(prev => [newRide, ...prev]);
        setStats(prev => ({
          ...prev,
          scans: prev.scans + 1,
        }));
      } catch (e) {
        __DEV__ && console.error('[SCAN] createRide error', e);
      }

      // 4. Calcul durée réelle via TomTom (async — met à jour la bulle quand disponible)
      if (result.pickupAddress && result.destinationAddress) {
        calculateRouteDuration(result.pickupAddress, result.destinationAddress)
          .then(minutes => {
            if (minutes !== null) scannerService.updateDuration(minutes);
          })
          .catch(() => {});
      }
    });

    const subFailed = scannerService.onScanFailed(() => {
      __DEV__ && console.log('[SCAN] failed');
      hapticError();
    });

    return () => {
      subResult?.remove();
      subFailed?.remove();
    };
  }, [user?.id, preferences]);

  const handleToggleScanner = async () => {
    if (Platform.OS !== 'android') return;
    if (scannerActive) {
      await scannerService.stop();
      setScannerActive(false);
      return;
    }
    try {
      await scannerService.start();
      setScannerActive(true);
    } catch {
      navigation.navigate('ScannerPermission');
    }
  };

  useEffect(() => {
    if (isOnline) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.4, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isOnline, pulseAnim]);

  const handleStatusUpdate = async (id: string, newStatus: 'ACCEPTED' | 'DECLINED') => {
    newStatus === 'ACCEPTED' ? hapticSuccess() : hapticMedium();
    setRides(prev => prev.map(r => (r.id === id ? { ...r, status: newStatus } : r)));
    setTimeout(() => {
      setRides(prev => prev.filter(r => r.id !== id));
    }, 700);
    try {
      await updateRideStatus(id, newStatus);
    } catch {
      fetchData();
    }
  };

  const handleAcceptPress = (id: string) => {
    setConfirmModal(id);
  };

  const handleConfirmYes = () => {
    if (!confirmModal) return;
    const id = confirmModal;
    setConfirmModal(null);
    handleStatusUpdate(id, 'ACCEPTED');
  };

  const handleConfirmNo = () => {
    if (!confirmModal) return;
    const id = confirmModal;
    setConfirmModal(null);
    setPriceModal({ rideId: id, input: '' });
  };

  const handlePriceConfirm = async () => {
    if (!priceModal) return;
    const cleaned = priceModal.input.replace(',', '.').trim();
    const fare = parseFloat(cleaned);
    if (!cleaned || isNaN(fare) || fare <= 0 || fare > 9999) return;
    {
      try {
        await updateRideFare(priceModal.rideId, fare);
        setRides(prev =>
          prev.map(r => r.id === priceModal.rideId ? { ...r, fare_final: fare } : r),
        );
      } catch (e) {
        __DEV__ && console.error('[PRICE] updateRideFare error', e);
      }
    }
    const id = priceModal.rideId;
    setPriceModal(null);
    handleStatusUpdate(id, 'ACCEPTED');
  };


  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isOnline) {
      interval = setInterval(() => setSessionSeconds(prev => prev + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isOnline]);

  const handleToggleOnline = async () => {
    if (!user || isSyncing) return;
    hapticMedium();
    setIsSyncing(true);
    const newStatus = !isOnline;
    const now = new Date().toISOString();
    try {
      if (newStatus) {
        const { data, error } = await supabase
          .from('online_sessions')
          .insert([{ user_id: user.id, start_at: now }])
          .select()
          .single();
        if (error) throw error;
        setCurrentSessionId(data.id);
        setSessionSeconds(0);
      } else {
        if (currentSessionId) {
          await supabase
            .from('online_sessions')
            .update({ end_at: now, duration_seconds: sessionSeconds })
            .eq('id', currentSessionId);
        }
        setCurrentSessionId(null);
      }
      await supabase.from('profiles').update({ is_online: newStatus }).eq('id', user.id);
      setIsOnline(newStatus);
      refreshProfile();
    } catch (e) {
      __DEV__ && console.error(e);
    } finally {
      setIsSyncing(false);
    }
  };

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      setFetchError(false);
      const { data: prefsData } = await supabase
        .from('preferences')
        .select('min_hourly_rate, min_km_rate, day_reset_hour')
        .eq('id', user.id)
        .maybeSingle();

      const resetHour = prefsData?.day_reset_hour === 3 ? 3 : 0;
      const resetTime = getDayStart(resetHour);

      if (prefsData) {
        const minHourly = Number(String(prefsData.min_hourly_rate ?? '25').replace(',', '.'));
        const minKm = Number(String(prefsData.min_km_rate ?? '1.2').replace(',', '.'));
        setPreferences({
          min_hourly_rate: Number.isFinite(minHourly) ? minHourly : 25,
          min_km_rate: Number.isFinite(minKm) ? minKm : 1.2,
        });
      }

      // Auto-expire old PENDING rides (before today's reset)
      await supabase
        .from('rides')
        .update({ status: 'DECLINED' })
        .eq('user_id', user.id)
        .eq('status', 'PENDING')
        .lt('created_at', resetTime.toISOString());

      const ridesData = await fetchRides(user.id, resetTime);

      const { data: sessionsData } = await supabase
        .from('online_sessions')
        .select('duration_seconds, start_at, end_at')
        .eq('user_id', user.id)
        .gte('start_at', resetTime.toISOString());

      const acceptedRides = ridesData.filter(r => r.status === 'ACCEPTED');
      const totalEarnings = acceptedRides.reduce((sum, r) => sum + effectiveFare(r), 0);
      const nowTs = Date.now();

      const totalOnlineSeconds = (sessionsData || []).reduce((sum, session) => {
        if (session.end_at && session.duration_seconds) return sum + session.duration_seconds;
        if (!session.end_at) return sum + Math.floor((nowTs - new Date(session.start_at).getTime()) / 1000);
        return sum;
      }, 0);

      const totalOnlineHours = totalOnlineSeconds / 3600;
      setStats({
        earnings: totalEarnings.toFixed(0),
        avgRate: (totalOnlineHours > 0 ? totalEarnings / totalOnlineHours : 0).toFixed(0),
        scans: ridesData.length,
      });
      setRides(ridesData);
      cacheRides(ridesData); // Cache pour mode hors-ligne
    } catch (e) {
      __DEV__ && console.error(e);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const acceptedCount = rides.filter(r => r.status === 'ACCEPTED').length;

  useEffect(() => {
    maybePromptRating(acceptedCount).then(shouldPrompt => {
      if (!shouldPrompt) return;
      markRatingPrompted();
      setRatingModal(true);
    });
  }, [acceptedCount]);

  const pendingRides = rides.filter(r => r.status === 'PENDING');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 16 }]} showsVerticalScrollIndicator={false}>

        {/* ── HEADER ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.appIconWrap}>
              <MaterialCommunityIcons name="steering" size={22} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.appTitle}>Strive</Text>
              <Text style={styles.appSubtitle}>{t('dashboard.subtitle')}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.settingsBtn, scannerActive && { backgroundColor: 'rgba(0,230,118,0.15)', borderColor: colors.primary }]}
            onPress={handleToggleScanner}
            accessibilityRole="button"
            accessibilityLabel={scannerActive ? t('scanner.stop', 'Stop scanner') : t('scanner.start', 'Start scanner')}
          >
            <MaterialCommunityIcons
              name="line-scan"
              size={20}
              color={scannerActive ? colors.primary : colors.textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* ── ONLINE TOGGLE ── */}
        <View style={[styles.onlinePill, isOnline && styles.onlinePillActive]}>
          <View style={styles.onlineLeft}>
            <Animated.View style={[styles.onlineDot, !isOnline && styles.onlineDotOff, isOnline && { transform: [{ scale: pulseAnim }] }]} />
            <Text style={[styles.onlineLabel, isOnline && styles.onlineLabelOn]}>
              {isOnline
                ? `${t('dashboard.online')}  ·  ${formatDuration(sessionSeconds)}`
                : t('dashboard.offline')}
            </Text>
          </View>
          {isSyncing ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 4 }} />
          ) : (
            <TouchableOpacity
              style={[styles.toggleBtn, isOnline && styles.toggleBtnActive]}
              onPress={handleToggleOnline}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={isOnline ? t('dashboard.goOffline') : t('dashboard.goOnline')}
            >
              <Feather name="power" size={14} color={colors.background} />
              <Text style={styles.toggleBtnText}>
                {isOnline ? t('dashboard.goOffline') : t('dashboard.goOnline')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── TODAY'S SESSION ── */}
        <View style={styles.sessionHeader}>
          <Text style={styles.sessionTitle}>{t('dashboard.session')}</Text>
          {isOnline && (
            <View style={styles.liveBadge}>
              <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
              <Text style={styles.liveText}>{t('dashboard.live')}</Text>
            </View>
          )}
        </View>

        <View style={styles.statRow}>
          <View style={styles.statCard} accessible accessibilityLabel={`${t('dashboard.earnings')}: ${stats.earnings}€`}>
            <Text style={styles.statLabel}>{t('dashboard.earnings')}</Text>
            <Text style={styles.statValue}>{stats.earnings}€</Text>
            <MaterialCommunityIcons name="cash" size={32} color="rgba(0,230,118,0.25)" style={styles.statIcon} />
          </View>
          <View style={styles.statCard} accessible accessibilityLabel={`${t('dashboard.avgRate')}: ${stats.avgRate}€/h`}>
            <Text style={styles.statLabel}>{t('dashboard.avgRate')}</Text>
            <Text style={[styles.statValue, { color: colors.primary }]}>{stats.avgRate}€/h</Text>
            <Feather name="trending-up" size={32} color="rgba(0,230,118,0.25)" style={styles.statIcon} />
          </View>
          <View style={styles.statCard} accessible accessibilityLabel={`${t('dashboard.scans')}: ${stats.scans}`}>
            <Text style={styles.statLabel}>{t('dashboard.scans')}</Text>
            <Text style={styles.statValue}>{stats.scans}</Text>
            <MaterialCommunityIcons name="qrcode-scan" size={32} color="rgba(0,230,118,0.25)" style={styles.statIcon} />
          </View>
        </View>


        {/* ── ERROR STATE ── */}
        {fetchError && (
          <View style={styles.errorCard}>
            <Feather name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{t('errors.loadFailed', 'Erreur de chargement')}</Text>
            <TouchableOpacity onPress={fetchData}>
              <Text style={styles.errorRetry}>{t('errors.retry', 'Réessayer')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── PREMIUM BANNER ── */}
        <PremiumBanner
          todayScanCount={rides.length}
          onPressUpgrade={() => navigation.navigate('SubscriptionScreen')}
          onPressShop={() => navigation.navigate('Shop')}
        />

        {/* ── PENDING SCANS HEADER ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('dashboard.pending')}</Text>
        </View>

        {/* ── SCAN LIMIT PAYWALL ── */}
        {!canScan && (
          <View style={styles.scanLimitCard}>
            <MaterialCommunityIcons name="shield-lock-outline" size={28} color={colors.danger} style={{ marginBottom: 10 }} />
            <Text style={styles.scanLimitTitle}>{t('dashboard.scanLimit.cardTitle', 'Quota journalier atteint')}</Text>
            <Text style={styles.scanLimitText}>
              {t('dashboard.scanLimit.cardText', "Vous avez utilisé vos {{count}} scans d'aujourd'hui.", { count: dailyScans })}
            </Text>
            <View style={styles.scanLimitActions}>
              <TouchableOpacity style={styles.scanLimitBtnSecondary} onPress={() => navigation.navigate('Shop')}>
                <Text style={styles.scanLimitBtnSecondaryText}>{t('dashboard.scanLimit.buyCredits', 'Acheter des crédits')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.scanLimitBtnPrimary} onPress={() => navigation.navigate('SubscriptionScreen')}>
                <Text style={styles.scanLimitBtnPrimaryText}>{t('dashboard.scanLimit.upgrade', 'Passer Plus')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── RIDES ── */}
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : pendingRides.length > 0 ? (
          pendingRides.map((ride, rideIndex) => {
            const rawPlatform = ride.platform ? ride.platform.toString().toUpperCase().trim() : 'UBER';
            const isPending = ride.status === 'PENDING';
            const distance = Number(ride.distance_km) || 0;
            const fare = effectiveFare(ride);
            const fareIsConfirmed = ride.fare_final != null;
            const hourlyRate = Number(ride.hourly_rate || 0);
            const kmRate = Number(ride.km_rate || 0);
            const platformColor = PLATFORM_COLORS[rawPlatform] ?? '#FFFFFF';
            const bgImage = platformBackgrounds[rawPlatform] ?? platformBackgrounds.UBER;
            const rateOk = hourlyRate >= preferences.min_hourly_rate;
            const platformLabel = rawPlatform.charAt(0) + rawPlatform.slice(1).toLowerCase();

            return (
              <AnimatedEntrance key={ride.id} delay={rideIndex * 80} slideFrom="bottom" slideDistance={30}>
              <View style={[styles.rideCard, !isPending && { opacity: 0.5 }]}>

                {/* ── IMAGE SECTION ── */}
                <View style={styles.rideImageWrap}>
                  <Image source={bgImage} style={styles.rideImage} resizeMode="cover" />
                  <LinearGradient
                    colors={['transparent', colors.surface]}
                    style={StyleSheet.absoluteFillObject}
                  />
                  {/* Overlaid badges — top */}
                  <View style={styles.imageBadgesRow}>
                    <View style={styles.platformPill}>
                      <View style={[styles.platformDot, { backgroundColor: platformColor }]} />
                      <Text style={styles.platformPillText}>{platformLabel}</Text>
                    </View>
                    <View style={[styles.ratePill, rateOk && styles.ratePillGood]}>
                      <Feather name="trending-up" size={12} color={rateOk ? colors.background : colors.textMuted} />
                      <Text style={[styles.ratePillText, rateOk && styles.ratePillTextGood]}>
                        {hourlyRate.toFixed(0)}€/h
                      </Text>
                    </View>
                    <View style={styles.timeAgoPill}>
                      <Text style={styles.timeAgoText}>{formatTimeAgo(ride.created_at, t)}</Text>
                    </View>
                  </View>
                </View>

                {/* ── CONTENT ── */}
                <View style={styles.rideContent}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Text style={styles.fareLabel}>{t('dashboard.estFare')}</Text>
                    {!fareIsConfirmed && (
                      <View style={styles.estBadge}>
                        <Text style={styles.estBadgeText}>{t('dashboard.estimated', 'est.')}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.fareRow}>
                    <Text style={styles.fareValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fare.toFixed(2)}€</Text>
                    <View style={styles.tripMetrics}>
                      <View style={styles.tripMetricCol}>
                        <Text style={styles.tripMetricLabel}>{t('dashboard.distance')}</Text>
                        <View style={styles.tripMetricItem}>
                          <MaterialCommunityIcons name="map-marker" size={14} color={colors.primary} />
                          <Text style={styles.tripMetricText}>{distance} km</Text>
                        </View>
                      </View>
                      <View style={styles.tripMetricCol}>
                        <Text style={styles.tripMetricLabel}>{t('dashboard.time')}</Text>
                        <View style={styles.tripMetricItem}>
                          <MaterialCommunityIcons name="clock-outline" size={14} color={colors.primary} />
                          <Text style={styles.tripMetricText}>{Number(ride.duration_min || 0)} min</Text>
                        </View>
                      </View>
                      <View style={styles.tripMetricCol}>
                        <Text style={styles.tripMetricLabel}>{t('dashboard.kmRate')}</Text>
                        <View style={styles.tripMetricItem}>
                          <Feather name="navigation" size={13} color={colors.primary} />
                          <Text style={styles.tripMetricText}>{kmRate.toFixed(2)}</Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* Actions */}
                  {isPending ? (
                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        style={styles.btnDecline}
                        onPress={() => handleStatusUpdate(ride.id, 'DECLINED')}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={t('dashboard.decline', 'Decline')}
                      >
                        <Feather name="x" size={18} color="#FF5A5A" />
                        <Text style={styles.btnDeclineText}>{t('dashboard.decline', 'Decline')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.btnAcceptGood}
                        onPress={() => handleAcceptPress(ride.id)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={t('dashboard.accept', 'Accept')}
                      >
                        <Feather name="check" size={18} color={colors.background} />
                        <Text style={styles.btnAcceptTextGood}>
                          {t('dashboard.accept', 'Accept')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.statusResult}>
                      <Feather
                        name={ride.status === 'ACCEPTED' ? 'check-circle' : 'slash'}
                        size={16}
                        color={ride.status === 'ACCEPTED' ? colors.primary : '#FF5252'}
                      />
                      <Text style={{ color: ride.status === 'ACCEPTED' ? colors.primary : '#FF5252', fontWeight: '700', fontSize: 14 }}>
                        {ride.status === 'ACCEPTED' ? t('dashboard.status.accepted') : t('dashboard.status.declined')}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              </AnimatedEntrance>
            );
          })
        ) : (
          <View style={styles.waitingContainer}>
            <MaterialCommunityIcons name="radar" size={32} color="rgba(0,230,118,0.3)" />
            <Text style={styles.waitingTitle}>{t('dashboard.waiting')}</Text>
          </View>
        )}

      </ScrollView>

      {/* ── PRICE CHECK CONFIRMATION MODAL ── */}
      <Modal
        visible={!!confirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconRing}>
              <MaterialCommunityIcons name="cash-check" size={32} color={colors.primary} />
            </View>
            <Text style={styles.confirmTitle}>
              {t('dashboard.priceCheck.title', 'Prix correct ?')}
            </Text>
            <Text style={styles.confirmSubtitle}>
              {t('dashboard.priceCheck.message', 'Le prix affiché est-il correct ?')}
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmBtnNo}
                onPress={handleConfirmNo}
                activeOpacity={0.8}
              >
                <Feather name="x" size={20} color={colors.danger} />
                <Text style={styles.confirmBtnNoText}>
                  {t('dashboard.priceCheck.no', 'Non')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtnYes}
                onPress={handleConfirmYes}
                activeOpacity={0.8}
              >
                <Feather name="check" size={20} color={colors.background} />
                <Text style={styles.confirmBtnYesText}>
                  {t('dashboard.priceCheck.yes', 'Oui')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── PRICE CORRECTION MODAL ── */}
      <Modal
        visible={!!priceModal}
        transparent
        animationType="fade"
        onRequestClose={() => setPriceModal(null)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {t('dashboard.priceModal.title', 'Prix réel de la course')}
            </Text>
            <Text style={styles.modalSubtitle}>
              {t('dashboard.priceModal.subtitle', 'Entrez le montant final affiché sur l\'application VTC')}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={priceModal?.input ?? ''}
              onChangeText={v => {
                // Only allow digits and one decimal point, max 4 digits before decimal, 2 after
                let cleaned = v.replace(',', '.').replace(/[^0-9.]/g, '');
                const parts = cleaned.split('.');
                if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
                if (parts[0] && parts[0].length > 4) cleaned = parts[0].slice(0, 4) + (parts[1] !== undefined ? '.' + parts[1] : '');
                if (parts[1] !== undefined && parts[1].length > 2) cleaned = parts[0] + '.' + parts[1].slice(0, 2);
                setPriceModal(prev => prev ? { ...prev, input: cleaned } : null);
              }}
              keyboardType="decimal-pad"
              placeholder="Ex: 14.50"
              placeholderTextColor={colors.textMuted}
              maxLength={7}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => { setPriceModal(null); handleStatusUpdate(priceModal!.rideId, 'ACCEPTED'); }}
              >
                <Text style={styles.modalBtnCancelText}>
                  {t('dashboard.priceModal.skip', 'Passer')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnConfirm}
                onPress={handlePriceConfirm}
              >
                <Text style={styles.modalBtnConfirmText}>
                  {t('dashboard.priceModal.confirm', 'Confirmer')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── RATING MODAL ── */}
      <Modal
        visible={ratingModal}
        transparent
        animationType="fade"
        onRequestClose={() => setRatingModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <MaterialCommunityIcons name="star-outline" size={32} color="#FFD700" />
            </View>
            <Text style={styles.modalTitle}>
              {t('rating.title')}
            </Text>
            <Text style={styles.modalSubtitle}>
              {t('rating.message')}
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => setRatingModal(false)}
              >
                <Text style={styles.modalBtnCancelText}>
                  {t('rating.notNow')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnConfirm}
                onPress={() => { setRatingModal(false); openStoreForRating(); }}
              >
                <Text style={styles.modalBtnConfirmText}>
                  {t('rating.rate')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingHorizontal: 16, paddingTop: 6 },

  // HEADER
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  appIconWrap: {
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: 'rgba(0,230,118,0.15)',
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.35)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  appTitle: { color: colors.textMain, fontSize: 17, fontWeight: '800' },
  appSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  settingsBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },

  // ONLINE PILL
  onlinePill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111E18',
    borderRadius: 50, paddingVertical: 8, paddingLeft: 18, paddingRight: 8,
    marginBottom: 22,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.15)',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  onlinePillActive: {
    borderColor: 'rgba(0,230,118,0.4)',
    backgroundColor: '#0D1F17',
    shadowOpacity: 0.2,
  },
  onlineLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  onlineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  onlineDotOff: { backgroundColor: '#3a3a3a' },
  onlineLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  onlineLabelOn: { color: colors.textMain },
  toggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: colors.primary,
    paddingVertical: 11, paddingHorizontal: 20, borderRadius: 50,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  toggleBtnActive: { backgroundColor: 'rgba(0,230,118,0.5)', shadowOpacity: 0.2 },
  toggleBtnText: { color: colors.background, fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },

  // SESSION
  sessionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sessionTitle: { color: colors.textDimmed, fontSize: 11, fontWeight: '700', letterSpacing: 1.8 },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,230,118,0.12)',
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.3)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  liveText: { color: colors.primary, fontSize: 11, fontWeight: '800' },

  statRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: '#111E18',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.12)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  statLabel: { color: colors.textDimmed, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 },
  statValue: { color: colors.textMain, fontSize: 26, fontWeight: '900' },
  statIcon: { position: 'absolute', top: 10, right: 10 },


  // SECTION HEADER
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { color: colors.textMain, fontSize: 20, fontWeight: '800' },

  // SCAN LIMIT
  scanLimitCard: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 20,
    alignItems: 'center', marginBottom: 18,
    borderWidth: 1, borderColor: 'rgba(255,90,90,0.2)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  scanLimitTitle: { color: colors.textMain, fontSize: 16, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  scanLimitText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  scanLimitActions: { flexDirection: 'row', gap: 10, width: '100%' },
  scanLimitBtnSecondary: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: colors.primary, alignItems: 'center',
  },
  scanLimitBtnSecondaryText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  scanLimitBtnPrimary: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: colors.primary, alignItems: 'center',
  },
  scanLimitBtnPrimaryText: { color: colors.background, fontSize: 13, fontWeight: '700' },

  // RIDE CARD
  rideCard: {
    backgroundColor: '#111E18',
    borderRadius: 22, marginBottom: 18,
    overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  rideImageWrap: { height: 130, position: 'relative' },
  rideImage: { width: '100%', height: '100%' },
  imageBadgesRow: {
    position: 'absolute', top: 10, left: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  platformPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.6, shadowRadius: 6, elevation: 6,
  },
  platformDot: { width: 8, height: 8, borderRadius: 4 },
  platformPillText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  ratePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  ratePillGood: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.6, shadowRadius: 8, elevation: 6,
  },
  ratePillText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  ratePillTextGood: { color: colors.background },
  timeAgoPill: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  timeAgoText: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '500' },

  rideContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  fareLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: '500', marginBottom: 2 },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 },
  fareValue: { color: '#fff', fontSize: 42, fontWeight: '900', letterSpacing: -1.5 },
  tripMetrics: { flexDirection: 'row', gap: 16, alignItems: 'flex-end' },
  tripMetricCol: { alignItems: 'flex-start' },
  tripMetricLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  tripMetricItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tripMetricText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  actionsRow: { flexDirection: 'row', gap: 10 },
  btnDecline: {
    flex: 1, height: 54, borderRadius: 14,
    borderWidth: 1.5, borderColor: 'rgba(255,90,90,0.45)',
    backgroundColor: 'rgba(255,90,90,0.08)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  btnDeclineText: { color: '#FF5A5A', fontSize: 16, fontWeight: '700' },
  btnAcceptGood: {
    flex: 1, height: 54, borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 10,
  },
  btnAcceptTextGood: { color: colors.background, fontSize: 16, fontWeight: '800' },

  statusResult: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 12, gap: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12,
  },

  // WAITING
  waitingContainer: { alignItems: 'center', paddingVertical: 50, gap: 14 },
  waitingTitle: { color: colors.textDimmed, fontSize: 14 },

  // ESTIMATED BADGE
  estBadge: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  estBadgeText: { color: colors.textDimmed, fontSize: 10, fontWeight: '600' },

  // ERROR STATE
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

  // PRICE MODAL
  // Confirm modal (price check)
  confirmCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.12)',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    elevation: 10,
  },
  confirmIconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,230,118,0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,230,118,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  confirmTitle: {
    color: colors.textMain,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  confirmSubtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 14,
    width: '100%',
  },
  confirmBtnNo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,77,77,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.2)',
  },
  confirmBtnNoText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 16,
  },
  confirmBtnYes: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  confirmBtnYesText: {
    color: colors.background,
    fontWeight: '800',
    fontSize: 16,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: colors.textMain,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: 22,
    lineHeight: 20,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: colors.textMain,
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 14,
    width: '100%',
  },
  modalBtnCancel: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  modalBtnCancelText: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 15,
  },
  modalBtnConfirm: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  modalBtnConfirmText: {
    color: colors.background,
    fontWeight: '800',
    fontSize: 15,
  },
});

export default DashboardScreen;
