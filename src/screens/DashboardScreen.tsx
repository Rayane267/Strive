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
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../theme/colors';
import { supabase } from '../services/supabase';
import { fetchRides, updateRideStatus, updateRideFare, createRide, effectiveFare } from '../services/ridesService';
import { fetchParserConfig } from '../services/parserConfigService';
import { useTranslation } from 'react-i18next';
import { Ride } from '../types/database';
import { formatDuration, getDayStart } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';
import { PremiumBanner } from '../components/PremiumBanner';
import { getEffectivePlanTier, getPlanLimits, getRemainingScans } from '../services/subscriptionService';
import { scannerService } from '../services/scanner';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_KEY, TOMTOM_API_KEY } from '@env';
import { maybePromptRating, markRatingPrompted, openStoreForRating } from '../utils/ratingPrompt';
import { extractWithGemini } from '../services/scanner/geminiFallback';
import { hapticSuccess, hapticError, hapticMedium, hapticHeavy } from '../utils/haptics';
import { cacheRides, queueOfflineRide, syncOfflineQueue } from '../services/offlineService';
import { registerPushToken, setupNotificationListeners } from '../services/notificationService';
import DashboardRideCard from '../components/DashboardRideCard';
import BrandLoader from '../components/BrandLoader';

/**
 * Fallback durée quand l'OCR n'a pas pu lire le `min` de la course.
 * Heuristique vitesse moyenne par tranche de distance — calibration FR/EU.
 * À garder en sync avec FloatingBubbleService.kt::estimateDurationMin et
 * ScanProcessor.swift::estimateDurationMin.
 */
function estimateDurationMin(distanceKm: number): number {
  if (distanceKm < 5)  return Math.round(distanceKm / 25 * 60);  // urbain dense
  if (distanceKm < 20) return Math.round(distanceKm / 45 * 60);  // mixte
  return Math.round(distanceKm / 60 * 60);                       // péri-urbain / autoroute
}

const DashboardScreen = () => {
  const { t } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<any>();

  const [rides, setRides] = useState<Ride[]>([]);
  const [stats, setStats] = useState({ earnings: '0', avgRate: '0', scans: 0 });
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState({ min_hourly_rate: 25, min_km_rate: 1.2, include_pickup: false });

  const tier = getEffectivePlanTier(profile);
  const { dailyScans } = getPlanLimits(tier);
  const extraCredits = profile?.extra_scan_credits ?? 0;
  // Utiliser stats.scans (autoritatif depuis fetchData + incrément local au scan)
  // plutôt que rides.length, qui décroît quand handleStatusUpdate filter une course
  // 700 ms après decline/accept → faisait remonter artificiellement le quota.
  const remaining = getRemainingScans(tier, stats.scans, extraCredits);
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

  // ── Config scanner (edge function Gemini + remote config OCR + TomTom) ──
  useEffect(() => {
    scannerService.setGeminiConfig(
      `${PUBLIC_SUPABASE_URL}/functions/v1/gemini-proxy`,
      PUBLIC_SUPABASE_KEY,
    );
    // Clé TomTom au natif : permet geocoding + routing pendant scan en background
    if (TOMTOM_API_KEY) scannerService.setTomTomApiKey(TOMTOM_API_KEY);
    fetchParserConfig().then(config => {
      if (config) scannerService.setParserConfig(config);
    });
// Sync timezone du téléphone vers profile (reset quota au midnight local)
    if (user?.id) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) {
          supabase.from('profiles').update({ timezone: tz }).eq('id', user.id);
        }
      } catch {}
    }
  }, [user?.id]);

  // ── Propage préférences + seuils à la bulle native ──────────────────────
  useEffect(() => {
    scannerService.setPreferences(preferences.include_pickup);
    scannerService.setThresholds(preferences.min_hourly_rate, preferences.min_km_rate);
  }, [preferences.include_pickup, preferences.min_hourly_rate, preferences.min_km_rate]);

  // ── Scanner listeners ─────────────────────────────────────────────────────
  const lastScanTsRef = useRef(0);
  // Ref pour canScan : évite la stale closure dans le listener onScanResult
  // (le useEffect ne se re-attache pas à chaque render pour éviter les fuites).
  const canScanRef = useRef(canScan);
  useEffect(() => { canScanRef.current = canScan; }, [canScan]);

  // Sync l'état quota au natif : la bulle Android / Share Extension iOS
  // affichent un message dédié sans déclencher OCR/TomTom/Gemini si quota
  // atteint. Économise les coûts cloud + signale clairement à l'utilisateur.
  useEffect(() => {
    try { scannerService.setQuotaReached(!canScan); } catch {}
  }, [canScan]);

  useEffect(() => {
    const subResult = scannerService.onScanResult(async (nativeResult) => {
      if (!user?.id) return;
      // Quota atteint côté client → on ignore le scan natif sans tenter
      // d'INSERT en DB (qui planterait avec daily_scan_quota_exceeded). Le
      // paywall scanLimitCard est déjà affiché en bas du Dashboard.
      if (!canScanRef.current) {
        __DEV__ && console.warn('[Scanner] quota atteint — scan ignoré');
        hapticError();
        return;
      }
      // Rate limit côté JS : ignore les events dupliqués <1s (défense en plus
      // du `scanInProgress` natif). Évite les double-inserts DB sur event RN
      // flaky.
      const now = Date.now();
      if (now - lastScanTsRef.current < 1000) {
        __DEV__ && console.warn('[Scanner] event dupliqué ignoré (<1s)');
        return;
      }
      lastScanTsRef.current = now;

      __DEV__ && console.info(
        '[Scanner:Start] résultat natif reçu —',
        { platform: nativeResult.platform, hasImage: !!nativeResult.imageBase64 },
      );
      __DEV__ && console.info('[Scanner:OCR] résultat OCR local :', {
        platform: nativeResult.platform,
        fare: nativeResult.fare,
        distanceKm: nativeResult.distanceKm,
        durationMin: nativeResult.durationMin,
        pickupAddress: nativeResult.pickupAddress,
        destinationAddress: nativeResult.destinationAddress,
        pickupDurationMin: nativeResult.pickupDurationMin,
        pickupDistanceKm: nativeResult.pickupDistanceKm,
      });
      // Diagnostic : dump brut des blocs ML Kit — permet de voir comment la
      // capture est fragmentée et d'affiner les heuristiques anti-fragmentation.
      if (__DEV__ && nativeResult.debugBlocks) {
        try {
          console.info('[Scanner:Debug] blocs ML Kit bruts :', JSON.parse(nativeResult.debugBlocks));
        } catch {
          console.info('[Scanner:Debug] blocs ML Kit bruts (raw) :', nativeResult.debugBlocks);
        }
      }

      // Le natif a déjà appelé TomTom et mis à jour la bulle. Ici on :
      //  - fallback Gemini si l'OCR est totalement vide (cas extrême)
      //  - ajoute le trajet d'approche (pickup) si la pref est active
      //  - consolide les valeurs pour la DB
      const ocrLooksBad =
        !Number.isFinite(nativeResult.fare) || nativeResult.fare <= 0 ||
        !Number.isFinite(nativeResult.distanceKm) || nativeResult.distanceKm <= 0;

      let result = nativeResult;
      if (ocrLooksBad && nativeResult.imageBase64) {
        __DEV__ && console.info('[Scanner:Fallback] OCR natif incomplet — Gemini');
        const gemini = await extractWithGemini(nativeResult.imageBase64);
        if (gemini) result = { ...gemini, imageBase64: undefined };
      }

      const includePickup = preferences.include_pickup
        && result.pickupDurationMin != null
        && result.pickupDistanceKm != null;

      const courseDuration = result.durationMin ?? estimateDurationMin(result.distanceKm);
      const totalDuration = includePickup
        ? (result.pickupDurationMin as number) + courseDuration
        : courseDuration;
      const totalDistance = includePickup
        ? (result.pickupDistanceKm as number) + result.distanceKm
        : result.distanceKm;

      const hourlyRate = result.fare / (totalDuration / 60);
      const kmRate = result.fare / totalDistance;
      const hrOk = hourlyRate >= preferences.min_hourly_rate;
      const kmOk = kmRate >= preferences.min_km_rate;
      const level = hrOk && kmOk ? 2 : (hrOk || kmOk) ? 1 : 0;

      hapticHeavy();

      __DEV__ && console.info('[Scanner:Final] valeurs DB :', {
        platform: result.platform,
        fare: result.fare,
        distanceKm: totalDistance,
        durationMin: totalDuration,
        hourlyRate,
        kmRate,
        verdict: level,
        includePickup,
      });

      // ── Log en DB (valeurs finales). Si Supabase tombe, on queue hors-ligne
      // pour garantir zéro scan perdu — useOfflineSync re-tente à la reconnexion.
      try {
        const newRide = await createRide({
          userId: user.id,
          platform: result.platform,
          fare: result.fare,
          distanceKm: totalDistance,
          durationMin: totalDuration,
          hourlyRate,
          kmRate,
        });
        setRides(prev => [newRide, ...prev]);
        setStats(prev => ({ ...prev, scans: prev.scans + 1 }));
        // Trigger flush queue offline : si des rides sont coincés, on profite
        // que le réseau marche pour les vider maintenant.
        syncOfflineQueue(async (queuedRide) => {
          await createRide({
            userId: user.id,
            platform: queuedRide.platform,
            fare: queuedRide.fare_estimated,
            distanceKm: queuedRide.distance_km,
            durationMin: queuedRide.duration_min,
            hourlyRate: queuedRide.hourly_rate,
            kmRate: queuedRide.km_rate,
          });
        }).catch(() => {});
      } catch (e) {
        __DEV__ && console.warn('[SCAN] createRide KO — queue offline', e);
        await queueOfflineRide({
          user_id: user.id,
          platform: result.platform === 'UNKNOWN' ? 'UBER' : result.platform,
          status: 'PENDING',
          fare_estimated: result.fare,
          fare_final: null,
          distance_km: totalDistance,
          duration_min: totalDuration,
          hourly_rate: hourlyRate,
          km_rate: kmRate,
          created_at: new Date().toISOString(),
        });
        // Affiche localement pour retour utilisateur (ID temporaire)
        setRides(prev => [{
          id: `offline-${Date.now()}`,
          user_id: user.id,
          platform: result.platform === 'UNKNOWN' ? 'UBER' : result.platform,
          status: 'PENDING',
          fare_estimated: result.fare,
          fare_final: null,
          distance_km: totalDistance,
          duration_min: totalDuration,
          hourly_rate: hourlyRate,
          km_rate: kmRate,
          created_at: new Date().toISOString(),
        }, ...prev]);
        setStats(prev => ({ ...prev, scans: prev.scans + 1 }));
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

  // fetchData est déclaré plus bas (l.420). On passe par une ref pour éviter
  // une dep cyclique sur useCallback + TDZ — handleStatusUpdate reste stable.
  const fetchDataRef = useRef<() => void>(() => {});

  const handleStatusUpdate = useCallback(async (id: string, newStatus: 'ACCEPTED' | 'DECLINED') => {
    newStatus === 'ACCEPTED' ? hapticSuccess() : hapticMedium();
    setRides(prev => prev.map(r => (r.id === id ? { ...r, status: newStatus } : r)));
    setTimeout(() => {
      setRides(prev => prev.filter(r => r.id !== id));
    }, 700);
    try {
      await updateRideStatus(id, newStatus);
    } catch {
      fetchDataRef.current();
    }
  }, []);

  const handleAcceptPress = useCallback((id: string) => {
    setConfirmModal(id);
  }, []);

  const handleDeclinePress = useCallback((id: string) => {
    handleStatusUpdate(id, 'DECLINED');
  }, [handleStatusUpdate]);

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

  const fetchingRef = useRef(false);
  const fetchData = useCallback(async () => {
    if (!user?.id || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      setLoading(true);
      setFetchError(false);
      const { data: prefsData } = await supabase
        .from('preferences')
        .select('min_hourly_rate, min_km_rate, day_reset_hour, include_pickup')
        .eq('id', user.id)
        .maybeSingle();

      const resetHour = prefsData?.day_reset_hour === 4 ? 4 : 0;
      const resetTime = getDayStart(resetHour);

      if (prefsData) {
        const minHourly = Number(String(prefsData.min_hourly_rate ?? '25').replace(',', '.'));
        const minKm = Number(String(prefsData.min_km_rate ?? '1.2').replace(',', '.'));
        setPreferences({
          min_hourly_rate: Number.isFinite(minHourly) ? minHourly : 25,
          min_km_rate: Number.isFinite(minKm) ? minKm : 1.2,
          include_pickup: Boolean(prefsData.include_pickup),
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
      fetchingRef.current = false;
    }
  }, [user?.id]);

  // Sync la ref pour handleStatusUpdate.catch (déclaré avant fetchData).
  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);

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
            <Image
              source={require('../assets/strive-logo.png')}
              style={styles.appIconImg}
            />
            <View>
              <Text style={styles.appTitle}>Strive</Text>
              <Text style={styles.appSubtitle}>{t('dashboard.subtitle')}</Text>
            </View>
          </View>
          {Platform.OS === 'android' && (
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
          )}
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
          <View
            style={styles.statCard}
            accessible
            accessibilityLabel={
              dailyScans !== null
                ? `${t('dashboard.scans')}: ${stats.scans} / ${dailyScans}`
                : `${t('dashboard.scans')}: ${stats.scans}`
            }
          >
            <Text style={styles.statLabel}>{t('dashboard.scans')}</Text>
            <Text style={styles.statValue}>
              {dailyScans !== null ? `${stats.scans}/${dailyScans}` : stats.scans}
            </Text>
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
              {t('dashboard.scanLimit.cardText', "Vous avez utilisé vos {{count}} scans d'aujourd'hui.", { count: dailyScans ?? 0 })}
            </Text>
            {/* Free → propose l'upgrade vers Plus.
                Plus → pas de bouton (pas de tier supérieur dispo au launch,
                       pas de boutique consumable non plus). Message "revenez
                       demain" pour signaler que le quota se reset. */}
            {tier === 'free' && (
              <View style={styles.scanLimitActions}>
                <TouchableOpacity style={styles.scanLimitBtnPrimary} onPress={() => navigation.navigate('SubscriptionScreen')}>
                  <Text style={styles.scanLimitBtnPrimaryText}>{t('dashboard.scanLimit.upgrade', 'Passer Plus')}</Text>
                </TouchableOpacity>
              </View>
            )}
            {tier === 'plus' && (
              <Text style={styles.scanLimitText}>
                {t('dashboard.scanLimit.comeBackTomorrow', 'Revenez demain pour scanner à nouveau.')}
              </Text>
            )}
          </View>
        )}

        {/* ── RIDES ── */}
        {loading ? (
          <BrandLoader style={{ marginTop: 30 }} />
        ) : pendingRides.length > 0 ? (
          pendingRides.map((ride, rideIndex) => (
            <DashboardRideCard
              key={ride.id}
              ride={ride}
              index={rideIndex}
              preferences={preferences}
              onAccept={handleAcceptPress}
              onDecline={handleDeclinePress}
            />
          ))
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
  appIconImg: {
    width: 42, height: 42, borderRadius: 12,
  },
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
  statValue: { color: colors.textMain, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
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

  // WAITING
  waitingContainer: { alignItems: 'center', paddingVertical: 50, gap: 14 },
  waitingTitle: { color: colors.textDimmed, fontSize: 14 },


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
