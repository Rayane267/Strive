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
  RefreshControl,
  NativeModules,
  NativeEventEmitter,
  AppState,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Sentry from '@sentry/react-native';
import { colors } from '../theme/colors';
import { supabase } from '../services/supabase';
import { fetchRides, updateRideStatus, updateRideFare, createRide, effectiveFare } from '../services/ridesService';
import { computeWeeklyTease, WeeklyTease } from '../utils/weeklyTease';
import { fetchParserConfig } from '../services/parserConfigService';
import { useTranslation } from 'react-i18next';
import { Ride } from '../types/database';
import { formatDuration, getDayStart } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';

import { getEffectivePlanTier, getPlanLimits, getRemainingScans, FREE_THRESHOLDS } from '../services/subscriptionService';
import { scannerService } from '../services/scanner';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_KEY, TOMTOM_API_KEY } from '@env';
import { maybePromptRating, markRatingPrompted, openStoreForRating } from '../utils/ratingPrompt';
import { extractWithGemini } from '../services/scanner/geminiFallback';
import { logScanEvent, fareBucket } from '../services/telemetryService';
import { logScanDebug } from '../services/scanDebugService';
import { logScanFailure, rememberLastFailure } from '../services/scanFailureService';
import { APP_VERSION_LABEL } from '../utils/appVersion';
import { hapticSuccess, hapticError, hapticMedium, hapticHeavy } from '../utils/haptics';
import { cacheRides, queueOfflineRide, syncOfflineQueue } from '../services/offlineService';
import { computeFuelCost, fetchFuelPrice } from '../services/fuelService';
import { registerPushToken, setupNotificationListeners } from '../services/notificationService';
import SafeGradient from '../components/SafeGradient';
import DashboardRideCard from '../components/DashboardRideCard';
import BrandLoader from '../components/BrandLoader';
import {
  scheduleInactivityReminder,
  cancelInactivityReminder,
  resetInactivityReminder,
  scheduleQuotaResetNotification,
  notifyQuotaReached,
  notifySessionClosed,
  scheduleWeeklyRecap,
  cancelWeeklyRecap,
} from '../services/localNotifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { ScanBridge } = NativeModules;

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

// Somme des secondes en ligne des sessions DÉJÀ terminées aujourd'hui. Sert de
// base au « temps de session du jour », affiché dans la Live Activity ET dans le
// compteur du Dashboard : base + session en cours. La session ouverte (end_at
// null) est exclue — on lui ajoute son temps écoulé en direct.
// La journée démarre à `resetHour` (préférence utilisateur : minuit ou 4 h),
// comme le quota et les stats — pas au minuit local en dur.
async function fetchTodayOnlineBaseSeconds(userId: string, resetHour: number): Promise<number> {
  const dayStart = getDayStart(resetHour);
  const { data } = await supabase
    .from('online_sessions')
    .select('duration_seconds')
    .eq('user_id', userId)
    .gte('start_at', dayStart.toISOString())
    .not('end_at', 'is', null);
  return (data ?? []).reduce((s: number, r: any) => s + (r.duration_seconds || 0), 0);
}

// Totaux du jour (gains + km) des courses ACCEPTÉES — utilisé pour réhydrater le
// mini-dashboard de la Live Activity à la restauration de session (sinon il
// affiche 0 jusqu'au prochain tag).
// Même frontière que `fetchTodayOnlineBaseSeconds` : le minuit local en dur
// donnait un €/h faux avec day_reset_hour = 4, en divisant des gains comptés
// depuis minuit par des heures comptées depuis 4h la veille.
async function fetchTodayAcceptedTotals(userId: string, resetHour: number): Promise<{ earnings: number; km: number }> {
  const dayStart = getDayStart(resetHour);
  const { data } = await supabase
    .from('rides')
    .select('fare_estimated, fare_final, distance_km')
    .eq('user_id', userId)
    .eq('status', 'ACCEPTED')
    .gte('created_at', dayStart.toISOString());
  const rows = data ?? [];
  const earnings = rows.reduce((s: number, r: any) => s + Number(r.fare_final ?? r.fare_estimated ?? 0), 0);
  const km = rows.reduce((s: number, r: any) => s + Number(r.distance_km ?? 0), 0);
  return { earnings, km };
}

// Sécurité « session oubliée » (cf. effet de restauration) : bornes appliquées
// quand une session ouverte est retrouvée à l'ouverture de l'app (les timers JS
// ne tournent pas app fermée). Sans activité depuis ce délai → abandonnée ;
// au-delà de la durée max → plafonnée. Le temps mort n'est jamais compté.
const SESSION_INACTIVITY_MS = 2 * 3600_000; // 2h sans course scannée
const SESSION_MAX_MS = 14 * 3600_000;       // durée max d'une session

const DashboardScreen = () => {
  const { t, i18n } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<any>();

  const [rides, setRides] = useState<Ride[]>([]);
  const [stats, setStats] = useState({ earnings: '0', avgRate: '0', scans: 0 });
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState({ min_hourly_rate: 25, min_km_rate: 1.2, include_pickup: true, deduct_fuel: false });
  // Coût carburant au km (conso × prix du jour) : pré-calculé ici car le natif
  // n'a ni le type de carburant ni le tarif à la pompe. 0 = rien à déduire.
  const [fuelPerKm, setFuelPerKm] = useState(0);

  const tier = getEffectivePlanTier(profile);
  const { dailyScans } = getPlanLimits(tier);
  const extraCredits = profile?.extra_scan_credits ?? 0;
  // Utiliser stats.scans (autoritatif depuis fetchData + incrément local au scan)
  // plutôt que rides.length, qui décroît quand handleStatusUpdate filter une course
  // 700 ms après decline/accept → faisait remonter artificiellement le quota.
  const remaining = getRemainingScans(tier, stats.scans, extraCredits);
  const canScan = remaining === null || remaining > 0;

  const [isOnline, setIsOnline] = useState(false);
  const [sessionStartTs, setSessionStartTs] = useState<number | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const lastScanTimeRef = useRef<number>(Date.now());
  const [priceModal, setPriceModal] = useState<{ rideId: string; input: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<string | null>(null); // rideId awaiting price confirmation
  const [ratingModal, setRatingModal] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dayResetHour, setDayResetHour] = useState(0);
  const [weeklyTease, setWeeklyTease] = useState<WeeklyTease>({ state: 'none', lossWeek: 0, lossMonth: 0, avoided: 0 });

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Push notifications ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    registerPushToken(user.id);
    const cleanup = setupNotificationListeners();
    return cleanup;
  }, [user?.id]);

  // Restaure une session existante depuis la BDD (jamais de nouvelle session auto)
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from('online_sessions')
        .select('id, start_at')
        .eq('user_id', user.id)
        .is('end_at', null)
        .order('start_at', { ascending: false })
        .limit(1)
        .single();
      if (data?.start_at) {
        // ── Sécurité session oubliée (app tuée / laissée en ligne) ──
        // Les timers d'auto-close ne tournent pas app fermée → une session peut
        // rester ouverte des heures/jours et fausser le €/h. À la restauration on
        // borne la session : (1) si aucune activité (dernière course scannée)
        // depuis SESSION_INACTIVITY_MS, ou (2) si elle dépasse SESSION_MAX_MS, on
        // la clôture à la dernière activité réelle (ou au plafond) au lieu de la
        // rouvrir. Le temps mort n'est jamais compté.
        const startTs = new Date(data.start_at).getTime();
        const { data: lastRide } = await supabase
          .from('rides')
          .select('created_at')
          .eq('user_id', user.id)
          .gte('created_at', data.start_at)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const lastActivityTs = Math.max(
          startTs,
          lastRide?.created_at ? new Date(lastRide.created_at).getTime() : startTs,
        );
        const now = Date.now();
        const abandoned =
          now - lastActivityTs > SESSION_INACTIVITY_MS ||
          now - startTs > SESSION_MAX_MS;
        if (abandoned) {
          const endTs = Math.min(lastActivityTs, startTs + SESSION_MAX_MS);
          await supabase
            .from('online_sessions')
            .update({
              end_at: new Date(endTs).toISOString(),
              duration_seconds: Math.max(0, Math.floor((endTs - startTs) / 1000)),
            })
            .eq('id', data.id);
          await supabase.from('profiles').update({ is_online: false }).eq('id', user.id);
          // Coupe la session sur les 2 plateformes : scanner natif (bulle Android
          // via stopScanner / scanner iOS) + Live Activity + flag online iOS.
          try { await scannerService.stop(); } catch {}
          setScannerActive(false);
          if (ScanBridge?.setSessionOnline) ScanBridge.setSessionOnline(false);
          if (Platform.OS === 'ios' && ScanBridge?.stopLiveActivity) ScanBridge.stopLiveActivity();
          notifySessionClosed();
          return;
        }
        setCurrentSessionId(data.id);
        setSessionStartTs(startTs);
        setIsOnline(true);
        if (ScanBridge?.setSessionOnline) ScanBridge.setSessionOnline(true);
        // Hors du bloc Live Activity : le compteur du Dashboard en a besoin sur
        // les deux plateformes, y compris quand la LA est indisponible.
        const restoredBase = await fetchTodayOnlineBaseSeconds(user.id, dayResetHourRef.current);
        todayOnlineBaseSecondsRef.current = restoredBase;
        setTodayOnlineBaseSeconds(restoredBase);
        if (Platform.OS === 'ios' && ScanBridge?.startLiveActivity) {
          const currentElapsed = Math.floor((Date.now() - startTs) / 1000);
          // Réhydrate les vrais totaux du jour (sinon 0 jusqu'au prochain tag).
          const totals = await fetchTodayAcceptedTotals(user.id, dayResetHourRef.current);
          const onlineHr = (todayOnlineBaseSecondsRef.current + currentElapsed) / 3600;
          ScanBridge.startLiveActivity({
            platform: 'IDLE',
            fare: 0, hourlyRate: 0, kmRate: 0,
            distanceKm: 0, durationMin: 0, verdictLevel: 1,
            todayEarnings: totals.earnings,
            todayHourlyRate: onlineHr > 0 ? totals.earnings / onlineHr : 0,
            todayKm: totals.km,
            onlineMinutes: Math.floor((todayOnlineBaseSecondsRef.current + currentElapsed) / 60),
            // Ancre du timer auto : début session − cumul déjà fait aujourd'hui.
            sessionStartEpoch: Math.floor(startTs / 1000) - todayOnlineBaseSecondsRef.current,
          });
        }
      }
    })();
  }, [user?.id]);

  // ── Live Activity dismissed → stop session ──
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const emitter = new NativeEventEmitter(ScanBridge);
    const sub = emitter.addListener('onLiveActivityDismissed', () => {
      if (isOnline && handleToggleOnlineRef.current) {
        handleToggleOnlineRef.current();
      }
    });
    return () => sub.remove();
  }, [isOnline]);

  // Sync l'état session → natif : garantit que la bulle (Android) / Share
  // Extension (iOS) connaît l'état « en ligne » même après un redémarrage du
  // process JS (sinon défaut natif = false → scan bloqué à tort). Idempotent ;
  // double les appels explicites des handlers online/offline sans effet de bord.
  useEffect(() => {
    if (ScanBridge?.setSessionOnline) ScanBridge.setSessionOnline(isOnline);
  }, [isOnline]);

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
    // Sync live-activity pref to native (defaults to true on fresh install)
    if (Platform.OS === 'ios') {
      AsyncStorage.getItem('@strive_use_live_activity').then(v => {
        const enabled = v !== '0';
        NativeModules.ScanBridge?.setUseLiveActivity(enabled);
      });
    }
    // Les deux plateformes : les strings natives (bulle Android, Live Activity et
    // notifications iOS) doivent suivre la langue choisie dans l'app, pas celle
    // du téléphone.
    NativeModules.ScanBridge?.setAppLanguage?.(i18n.language);
    // Sync timezone du téléphone vers profile (reset quota au midnight local).
    // Écriture UNIQUEMENT si la valeur a changé : l'appel était inconditionnel et
    // repartait à chaque montage du Dashboard, pour un fuseau qui ne bouge
    // pratiquement jamais (954 updates observés pour 14 profils en base).
    if (user?.id) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz && tz !== profile?.timezone) {
          supabase.from('profiles').update({ timezone: tz }).eq('id', user.id);
        }
      } catch {}
    }
  }, [user?.id, i18n.language, profile?.timezone]);

  // ── Propage préférences + seuils à la bulle native ──────────────────────
  useEffect(() => {
    scannerService.setPreferences(preferences.include_pickup);
    scannerService.setThresholds(preferences.min_hourly_rate, preferences.min_km_rate);
  }, [preferences.include_pickup, preferences.min_hourly_rate, preferences.min_km_rate]);

  // ── Scanner listeners ─────────────────────────────────────────────────────
  const lastScanTsRef = useRef(0);
  // scanTs déjà traités : la file native peut livrer plusieurs courses d'un
  // coup, il faut les distinguer sans les confondre avec un doublon d'event.
  const processedScanTsRef = useRef<number[]>([]);
  const canScanRef = useRef(canScan);
  const scanCountRef = useRef(stats.scans);
  const isOnlineRef = useRef(isOnline);
  // Refs pour les valeurs lues dans le listener de scan (deps non listées sinon
  // → valeurs obsolètes au moment du scan après changement de tier/crédits/reset).
  const tierRef = useRef(tier);
  const extraCreditsRef = useRef(extraCredits);
  const dayResetHourRef = useRef(dayResetHour);
  useEffect(() => { canScanRef.current = canScan; }, [canScan]);
  useEffect(() => { scanCountRef.current = stats.scans; }, [stats.scans]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  useEffect(() => { tierRef.current = tier; }, [tier]);
  useEffect(() => { extraCreditsRef.current = extraCredits; }, [extraCredits]);
  useEffect(() => { dayResetHourRef.current = dayResetHour; }, [dayResetHour]);

  // Carburant : conso/type du profil + prix unitaire résolu UNE fois (table
  // fuel_prices, repli constante). Lu via ref dans le listener de scan pour
  // figer le coût carburant de chaque course sans recalcul à la volée.
  const fuelRef = useRef({ avgCons: 0, fuelType: 'essence', fuelPrice: 0 });

  // ── Réconciliation décision notif (Accepter/Refuser) ↔ course ───────────────
  // scanTs → id de la course créée (corrélation avec la décision tapée sur la
  // notif iOS). bufferedDecisions : décision arrivée AVANT la création de la
  // course (drain notif avant drain scan au foreground) → appliquée à sa création.
  const rideIdByScanTsRef = useRef<Map<number, string>>(new Map());
  const bufferedDecisionsRef = useRef<Map<number, 'ACCEPTED' | 'DECLINED'>>(new Map());
  const ridesRef = useRef<Ride[]>([]);
  const applyRideDecisionRef = useRef<(scanTs: number, status: 'ACCEPTED' | 'DECLINED') => void>(() => {});

  // Cumul des secondes en ligne des sessions terminées aujourd'hui (hors session
  // en cours) → base du « temps de session du jour » poussé à la Live Activity.
  // Doublé en state : le compteur du Dashboard l'affiche, il lui faut un rendu.
  const todayOnlineBaseSecondsRef = useRef(0);
  const [todayOnlineBaseSeconds, setTodayOnlineBaseSeconds] = useState(0);

  // La préférence dayResetHour arrive après coup (fetch des préférences) : une
  // base calculée avec la borne de minuit alors que l'utilisateur est en 4 h
  // serait sous-évaluée. On la recalcule dès que la borne est connue.
  useEffect(() => {
    if (!isOnline || !user?.id) return;
    let cancelled = false;
    fetchTodayOnlineBaseSeconds(user.id, dayResetHour)
      .then(seconds => {
        if (cancelled) return;
        todayOnlineBaseSecondsRef.current = seconds;
        setTodayOnlineBaseSeconds(seconds);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dayResetHour, isOnline, user?.id]);

  useEffect(() => {
    const avgCons = profile?.avg_cons ?? 0;
    const fuelType = profile?.fuel_type ?? 'essence';
    fuelRef.current = { ...fuelRef.current, avgCons, fuelType };
    if (avgCons > 0) {
      fetchFuelPrice(fuelType, profile?.elec_price).then(fuelPrice => {
        fuelRef.current = { avgCons, fuelType, fuelPrice };
        // Même formule que computeFuelCost, ramenée au km.
        setFuelPerKm(fuelPrice > 0 ? (avgCons / 100) * fuelPrice : 0);
      });
    } else {
      setFuelPerKm(0);
    }
  }, [profile?.avg_cons, profile?.fuel_type, profile?.elec_price]);

  // Prix net de carburant dans la Live Activity — affichage seul, le verdict et
  // les tarifs enregistrés restent bruts.
  useEffect(() => {
    try { scannerService.setFuelDeduction(preferences.deduct_fuel, fuelPerKm); } catch {}
  }, [preferences.deduct_fuel, fuelPerKm]);

  // Sync l'état quota au natif : la bulle Android / Share Extension iOS
  // affichent un message dédié sans déclencher OCR/TomTom/Gemini si quota
  // atteint. Économise les coûts cloud + signale clairement à l'utilisateur.
  useEffect(() => {
    // Deux appels bridge ISOLÉS : si setQuotaReached échoue (ex: régression de
    // signature native), setScanQuota — qui alimente le compteur natif, source
    // du gate quota côté extension/bulle — doit quand même partir.
    try { scannerService.setQuotaReached(!canScan, tier === 'free'); } catch {}
    // Compteur autoritatif poussé au natif → il applique le quota lui-même même
    // quand le JS est suspendu (scan via Share Extension / bulle).
    try { scannerService.setScanQuota(stats.scans, dailyScans ?? -1, dayResetHour); } catch {}
    if (!canScan) scheduleQuotaResetNotification(0);
  }, [canScan, tier, stats.scans, dailyScans, dayResetHour]);

  // Tease de perte hebdo (free uniquement) — calcul sur les vraies courses des
  // 7 derniers jours. Aversion à la perte (perte projetée) → conversion Plus.
  useEffect(() => {
    if (tier !== 'free' || !user?.id) {
      setWeeklyTease({ state: 'none', lossWeek: 0, lossMonth: 0, avoided: 0 });
      cancelWeeklyRecap();
      return;
    }
    (async () => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const weekRides = await fetchRides(user.id, since);
        const tease = computeWeeklyTease(weekRides, preferences.min_hourly_rate, preferences.min_km_rate);
        setWeeklyTease(tease);
        // Récap hebdo (dimanche 19h) : montant si perte significative, sinon générique.
        scheduleWeeklyRecap(tease.state === 'loss' ? tease.lossWeek : undefined);
      } catch {
        setWeeklyTease({ state: 'none', lossWeek: 0, lossMonth: 0, avoided: 0 });
      }
    })();
  }, [tier, user?.id, preferences.min_hourly_rate, preferences.min_km_rate, stats.scans]);

  useEffect(() => {
    const subResult = scannerService.onScanResult(async (nativeResult) => {
      if (!user?.id) return;
      // Quota atteint côté client → on ignore le scan natif sans tenter
      // d'INSERT en DB (qui planterait avec daily_scan_quota_exceeded). Le
      // paywall scanLimitCard est déjà affiché en bas du Dashboard.
      if (!isOnlineRef.current) {
        hapticError();
        return;
      }
      if (!canScanRef.current) {
        __DEV__ && console.warn('[Scanner] quota atteint — scan ignoré');
        hapticError();
        return;
      }
      // Anti-doublon : on déduplique sur l'identité du scan (`scanTs`), pas sur
      // son heure d'arrivée. Le natif vide sa file d'attente d'un seul coup —
      // plusieurs courses légitimes arrivent donc dans la même milliseconde, et
      // une fenêtre temporelle les aurait toutes jetées sauf la première.
      const scanTs = Number((nativeResult as any).scanTs) || 0;
      if (scanTs > 0) {
        if (processedScanTsRef.current.includes(scanTs)) {
          __DEV__ && console.warn('[Scanner] event dupliqué ignoré (même scanTs)');
          return;
        }
        processedScanTsRef.current = [...processedScanTsRef.current.slice(-19), scanTs];
      } else {
        // Payload sans scanTs (ancien build encore en attente dans l'App Group) :
        // on retombe sur la fenêtre d'une seconde.
        const now = Date.now();
        if (now - lastScanTsRef.current < 1000) {
          __DEV__ && console.warn('[Scanner] event dupliqué ignoré (<1s)');
          return;
        }
        lastScanTsRef.current = now;
      }

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
      let usedGemini = false;
      if (ocrLooksBad && nativeResult.imageBase64) {
        __DEV__ && console.info('[Scanner:Fallback] OCR natif incomplet — Gemini');
        const gemini = await extractWithGemini(nativeResult.imageBase64);
        if (gemini) { result = { ...gemini, imageBase64: undefined }; usedGemini = true; }
      } else if (nativeResult.imageBase64 && (!result.pickupAddress || !result.destinationAddress)) {
        // Récupération CIBLÉE d'adresse : l'OCR a le prix/distance mais a raté une
        // adresse (souvent une destination POI sans mot-clé de voie ni numéro).
        // On ne refait pas tout le parse — Gemini comble uniquement l'adresse
        // manquante, on garde les valeurs natives. Borné par le budget Gemini.
        __DEV__ && console.info('[Scanner:Fallback] adresse manquante — Gemini (ciblé)');
        const gemini = await extractWithGemini(nativeResult.imageBase64);
        if (gemini) {
          result = {
            ...result,
            pickupAddress: result.pickupAddress ?? gemini.pickupAddress,
            destinationAddress: result.destinationAddress ?? gemini.destinationAddress,
            // Sans ça l'approche lue par Gemini était jetée → includePickup
            // restait sans effet sur tout scan passé par le fallback.
            pickupDurationMin: result.pickupDurationMin ?? gemini.pickupDurationMin,
            pickupDistanceKm: result.pickupDistanceKm ?? gemini.pickupDistanceKm,
          };
          usedGemini = true;
        }
      }

      // Règle produit : sans les 2 adresses, aucun géocodage TomTom possible →
      // les métriques reposent sur l'OCR brut, peu fiable (durée d'approche
      // confondue avec la course → €/h gonflé). Le fallback Gemini a déjà été
      // tenté ci-dessus. On refuse de persister/afficher une course douteuse :
      // scan échoué plutôt qu'une valeur trompeuse.
      // Sans les 2 adresses on n'enregistre pas (métriques non fiables sans
      // géocodage). Le « scan échoué » est affiché DANS la Live Activity côté
      // natif — inutile (et indésirable) de l'afficher aussi dans l'app. Sur iOS
      // ce cas n'arrive quasi plus : l'AppIntent tente Gemini puis montre
      // l'erreur en LA sans rien sauvegarder. Garde silencieuse de sécurité.
      if (!result.pickupAddress?.trim() || !result.destinationAddress?.trim()) {
        __DEV__ && console.warn('[Scanner] adresses incomplètes — course ignorée (silencieux)');
        return;
      }

      const includePickup = preferences.include_pickup
        && result.pickupDurationMin != null
        && result.pickupDistanceKm != null;

      // Durée course : on n'utilise l'OCR que si > 0 — un `0` lu par erreur ferait
      // diviser par zéro (€/h = Infinity). Sinon estimation heuristique.
      const courseDuration = (result.durationMin && result.durationMin > 0)
        ? result.durationMin
        : estimateDurationMin(result.distanceKm);
      const totalDuration = Math.max(1, includePickup
        ? (result.pickupDurationMin as number) + courseDuration
        : courseDuration);
      const totalDistance = includePickup
        ? (result.pickupDistanceKm as number) + result.distanceKm
        : result.distanceKm;

      const hourlyRate = result.fare / (totalDuration / 60);
      const kmRate = totalDistance > 0 ? result.fare / totalDistance : 0;

      // Filet final anti-valeurs aberrantes (ex: "8 930 934 €/km" remonté en test).
      // Le natif filtre déjà via isSane, mais le fallback Gemini / certains chemins
      // ne re-valident pas le ratio → on bloque ici tout ce qui est non fini ou
      // physiquement impossible AVANT d'écrire la course en DB.
      if (!Number.isFinite(hourlyRate) || !Number.isFinite(kmRate)
        || kmRate <= 0 || kmRate > 50
        || hourlyRate <= 0 || hourlyRate > 1000) {
        __DEV__ && console.warn('[Scanner] valeurs aberrantes rejetées', { hourlyRate, kmRate, totalDistance, totalDuration });
        hapticError();
        return;
      }

      const hrOk = hourlyRate >= preferences.min_hourly_rate;
      const kmOk = kmRate >= preferences.min_km_rate;
      const level = hrOk && kmOk ? 2 : (hrOk || kmOk) ? 1 : 0;

      // Net carburant figé au moment du scan (prix du jour) → dataset daté.
      // Non affiché par course (le verdict suffit) ; alimente les stats / modèles.
      const { avgCons, fuelPrice } = fuelRef.current;
      const fuelCost = computeFuelCost(totalDistance, avgCons, fuelPrice);
      const netProfit = Math.round((result.fare - fuelCost) * 100) / 100;

      hapticHeavy();
      lastScanTimeRef.current = Date.now();
      resetInactivityReminder();

      // Incrémente immédiatement (pas d'attente re-render React)
      scanCountRef.current++;
      try { scannerService.setScanQuota(scanCountRef.current, getPlanLimits(tierRef.current).dailyScans ?? -1, dayResetHourRef.current); } catch {}
      const newRemaining = getRemainingScans(tierRef.current, scanCountRef.current, extraCreditsRef.current);
      if (newRemaining !== null && newRemaining <= 0) {
        canScanRef.current = false;
        try { scannerService.setQuotaReached(true, tierRef.current === 'free'); } catch {}
        notifyQuotaReached(dayResetHourRef.current);
        scheduleQuotaResetNotification(dayResetHourRef.current);
      }

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

      // Télémétrie non nominative (taux de détection adresse, coût Gemini) —
      // fire-and-forget, jamais bloquant. Aucune donnée perso (cf. scan_events).
      logScanEvent({
        platform: result.platform,
        addressesFound: (result.pickupAddress ? 1 : 0) + (result.destinationAddress ? 1 : 0),
        geminiFallback: usedGemini,
        durationSource: (result.durationMin && result.durationMin > 0) ? 'reported' : 'estimated',
        verdict: level,
        fareBucket: fareBucket(result.fare),
      });

      // Capture diagnostique (bêta) : si le parser NATIF a raté une adresse, on
      // stocke les blocs OCR pour reproduire le cas en fixture + amorcer un
      // dataset (native vs gemini). Données perso → table scan_debug privée,
      // RLS owner-only, rétention 30 j. Fire-and-forget.
      const nativePickupMissing = !nativeResult.pickupAddress;
      const nativeDestMissing = !nativeResult.destinationAddress;
      if (nativeResult.debugBlocks && (nativePickupMissing || nativeDestMissing)) {
        logScanDebug({
          platform: nativeResult.platform,
          screenHeight: nativeResult.screenHeight ?? null,
          blocksJson: nativeResult.debugBlocks,
          nativePickup: nativeResult.pickupAddress ?? null,
          nativeDestination: nativeResult.destinationAddress ?? null,
          nativeFare: nativeResult.fare,
          nativeDistanceKm: nativeResult.distanceKm,
          nativeDurationMin: nativeResult.durationMin ?? null,
          pickupMissing: nativePickupMissing,
          destMissing: nativeDestMissing,
          geminiUsed: usedGemini,
          // Ce que Gemini a récupéré sur le champ que le natif avait raté = label approché.
          geminiPickup: usedGemini && nativePickupMissing ? (result.pickupAddress ?? null) : null,
          geminiDestination: usedGemini && nativeDestMissing ? (result.destinationAddress ?? null) : null,
          appVersion: APP_VERSION_LABEL,
        });
      }

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
          fuelCost,
          netProfit,
          pickupAddress: result.pickupAddress,
          destinationAddress: result.destinationAddress,
        });
        // `null` = doublon écarté par le trigger : la course identique est déjà
        // dans la liste et déjà comptée. On ne recrée pas de carte, on ne
        // ré-incrémente pas le compteur, et surtout on ne met RIEN en file
        // offline — c'est ce qui recréait le doublon plus tard.
        if (!newRide) {
          __DEV__ && console.warn('[SCAN] doublon écarté côté DB — rien à créer');
          return;
        }
        setRides(prev => [newRide, ...prev]);
        setStats(prev => ({ ...prev, scans: prev.scans + 1 }));
        // Corrélation pour les actions de notif : on retient scanTs → id, et si
        // une décision Accepter/Refuser est déjà arrivée (tapée avant l'ouverture
        // de l'app), on l'applique immédiatement à la course fraîchement créée.
        if (nativeResult.scanTs != null) {
          rideIdByScanTsRef.current.set(nativeResult.scanTs, newRide.id);
          const buffered = bufferedDecisionsRef.current.get(nativeResult.scanTs);
          if (buffered) {
            bufferedDecisionsRef.current.delete(nativeResult.scanTs);
            applyRideDecisionRef.current(nativeResult.scanTs, buffered);
          }
        }
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
            fuelCost: queuedRide.fuel_cost,
            netProfit: queuedRide.net_profit,
            pickupAddress: queuedRide.pickup_address,
            destinationAddress: queuedRide.destination_address,
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
          fuel_cost: fuelCost,
          net_profit: netProfit,
          pickup_address: result.pickupAddress ?? null,
          destination_address: result.destinationAddress ?? null,
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
          fuel_cost: fuelCost,
          net_profit: netProfit,
          pickup_address: result.pickupAddress ?? null,
          destination_address: result.destinationAddress ?? null,
          created_at: new Date().toISOString(),
        }, ...prev]);
        setStats(prev => ({ ...prev, scans: prev.scans + 1 }));
      }
    });

    const subFailed = scannerService.onScanFailed(() => {
      __DEV__ && console.log('[SCAN] failed');
      hapticError();
    });

    // Trace de diagnostic des scans qui n'aboutissent pas. Le natif remonte ici
    // aussi les échecs survenus pendant que le JS ne tournait pas (raccourci iOS
    // dans un autre process, bulle Android avec l'app tuée) — sans ça, une panne
    // pouvait toucher tout le parc sans laisser la moindre donnée.
    const subFailure = scannerService.onScanFailure?.(f => {
      __DEV__ && console.log('[SCAN] failure', f.reason, f.detail ?? '');
      const failure = {
        reason: f.reason,
        surface: f.surface,
        platform: f.platform ?? null,
        detail: f.detail ?? null,
        appVersion: APP_VERSION_LABEL,
        occurredAt: f.occurredAt ?? null,
      };
      logScanFailure(failure);
      // Mémorisé localement pour être joint au prochain ticket de support :
      // un chauffeur qui écrit vient presque toujours de vivre cet échec.
      rememberLastFailure(failure);
    });

    return () => {
      subResult?.remove();
      subFailed?.remove();
      subFailure?.remove();
    };
  }, [user?.id, preferences, t]);

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
    setRides(prev => {
      const updated = prev.map(r => (r.id === id ? { ...r, status: newStatus } : r));
      if (newStatus === 'ACCEPTED') {
        const accepted = updated.filter(r => r.status === 'ACCEPTED');
        const totalEarnings = accepted.reduce((sum, r) => sum + effectiveFare(r), 0);
        const totalKm = accepted.reduce((sum, r) => sum + (r.distance_km || 0), 0);
        // €/h sur le temps en ligne CUMULÉ du jour (sessions terminées + courante).
        const onlineH = (todayOnlineBaseSecondsRef.current + sessionSeconds) / 3600 || 1/3600;
        const avgRate = totalEarnings / onlineH;
        setStats(s => ({
          ...s,
          earnings: totalEarnings.toFixed(0),
          avgRate: avgRate.toFixed(0),
        }));
        // KPI poussés au natif : iOS → Live Activity, Android → notification
        // persistante du foreground service (même tableau de bord du jour).
        if (ScanBridge?.updateSessionKPI) {
          ScanBridge.updateSessionKPI({
            todayEarnings: totalEarnings,
            todayHourlyRate: avgRate,
            todayKm: totalKm,
            onlineMinutes: Math.floor((todayOnlineBaseSecondsRef.current + sessionSeconds) / 60),
          });
        }
      }
      return updated;
    });
    setTimeout(() => {
      setRides(prev => prev.filter(r => r.id !== id));
    }, 500);
    try {
      await updateRideStatus(id, newStatus);
    } catch (e) {
      // Le serveur n'a pas pris l'update → l'UI a déjà retiré la course (optimiste).
      // On signale l'échec (haptique) et on resync depuis la DB (source de vérité)
      // pour ne pas laisser la course disparue alors qu'elle est toujours PENDING.
      Sentry.captureException(e, { tags: { flow: 'ride_status_update' } });
      hapticError();
      fetchDataRef.current?.();
    }
  }, [sessionSeconds]);

  // Décision Accepter/Refuser venue d'une action de notification (iOS) :
  //  1. mapping en mémoire scanTs → id (cas app vivante),
  //  2. sinon repli sur la course PENDING dont la création est la plus proche
  //     du scan (≤ 3 min) — couvre le cold start où le mapping est vide,
  //  3. sinon la course n'existe pas encore → on bufferise (appliquée à sa création).
  const applyRideDecision = useCallback((scanTs: number, status: 'ACCEPTED' | 'DECLINED') => {
    let rideId = rideIdByScanTsRef.current.get(scanTs);
    if (!rideId) {
      const cand = ridesRef.current
        .filter(r => r.status === 'PENDING')
        .map(r => ({ id: r.id, dt: Math.abs(new Date(r.created_at).getTime() / 1000 - scanTs) }))
        .filter(x => x.dt < 180)
        .sort((a, b) => a.dt - b.dt)[0];
      rideId = cand?.id;
    }
    if (rideId) handleStatusUpdate(rideId, status);
    else bufferedDecisionsRef.current.set(scanTs, status);
  }, [handleStatusUpdate]);

  useEffect(() => { applyRideDecisionRef.current = applyRideDecision; }, [applyRideDecision]);
  useEffect(() => { ridesRef.current = rides; }, [rides]);

  useEffect(() => {
    const sub = scannerService.onRideDecision(({ scanTs, status }) => {
      applyRideDecisionRef.current(scanTs, status);
    });
    return () => sub?.remove();
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
        // Nouveau montant → les métriques figées au scan (€/h, €/km, net) sont
        // recalculées dessus, sinon l'Historique garderait celles de l'estimation.
        const ride = ridesRef.current.find(r => r.id === priceModal.rideId);
        const distanceKm = Number(ride?.distance_km ?? 0);
        const durationMin = Number(ride?.duration_min ?? 0);
        await updateRideFare(priceModal.rideId, fare, {
          distanceKm,
          durationMin,
          fuelCost: ride?.fuel_cost ?? null,
        });
        setRides(prev =>
          prev.map(r => r.id === priceModal.rideId ? {
            ...r,
            fare_final: fare,
            hourly_rate: durationMin > 0 ? fare / (durationMin / 60) : r.hourly_rate,
            km_rate: distanceKm > 0 ? fare / distanceKm : r.km_rate,
            net_profit: r.fuel_cost != null
              ? Math.round((fare - r.fuel_cost) * 100) / 100
              : r.net_profit,
          } : r),
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
    if (!isOnline || !sessionStartTs) return;
    const tick = () => setSessionSeconds(Math.floor((Date.now() - sessionStartTs) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => { clearInterval(interval); sub.remove(); };
  }, [isOnline, sessionStartTs]);

  // Auto-close session après SESSION_INACTIVITY_MS (2h) sans scan. La notif de
  // rappel d'inactivité est planifiée séparément à 1h (scheduleInactivityReminder,
  // resettée à chaque scan) : 1h → notif, 2h → coupure.
  useEffect(() => {
    if (!isOnline) return;
    lastScanTimeRef.current = Date.now();
    const check = setInterval(() => {
      if (Date.now() - lastScanTimeRef.current > SESSION_INACTIVITY_MS) {
        notifySessionClosed();
        // Stoppe aussi la bulle/scanner natif (Android : stopScanner) — sinon
        // l'overlay reste affiché alors que la session est fermée.
        scannerService.stop().catch(() => {});
        setScannerActive(false);
        handleToggleOnlineRef.current?.();
      }
    }, 5 * 60_000);
    return () => clearInterval(check);
  }, [isOnline]);

  // Split session that already spans a past reset boundary (app restored / came back from background)
  useEffect(() => {
    if (!isOnline || !user?.id || !currentSessionId || !sessionStartTs) return;
    const resetBoundary = getDayStart(dayResetHour);
    if (sessionStartTs >= resetBoundary.getTime()) return; // session is within current day
    (async () => {
      const boundary = resetBoundary.toISOString();
      const elapsed = Math.floor((resetBoundary.getTime() - sessionStartTs) / 1000);
      await supabase
        .from('online_sessions')
        .update({ end_at: boundary, duration_seconds: Math.max(elapsed, 0) })
        .eq('id', currentSessionId);
      const { data } = await supabase
        .from('online_sessions')
        .insert([{ user_id: user.id, start_at: boundary }])
        .select()
        .single();
      if (data) {
        setCurrentSessionId(data.id);
        setSessionStartTs(resetBoundary.getTime());
        setSessionSeconds(Math.floor((Date.now() - resetBoundary.getTime()) / 1000));
        // Nouvelle journée : le cumul précédent appartient à la veille.
        todayOnlineBaseSecondsRef.current = 0;
        setTodayOnlineBaseSeconds(0);
      }
      fetchDataRef.current?.();
    })();
  }, [isOnline, dayResetHour, user?.id, currentSessionId, sessionStartTs]);

  // Schedule session split at next reset boundary (user stays online past midnight/4h)
  useEffect(() => {
    if (!isOnline || !user?.id) return;
    const now = new Date();
    const nextReset = new Date(now);
    nextReset.setHours(dayResetHour, 0, 0, 0);
    if (nextReset.getTime() <= now.getTime()) {
      nextReset.setDate(nextReset.getDate() + 1);
    }
    const msUntilReset = nextReset.getTime() - now.getTime();
    const timer = setTimeout(async () => {
      if (!isOnlineRef.current || !currentSessionId) return;
      const boundary = nextReset.toISOString();
      const elapsed = Math.floor((nextReset.getTime() - (sessionStartTs ?? Date.now())) / 1000);
      await supabase
        .from('online_sessions')
        .update({ end_at: boundary, duration_seconds: Math.max(elapsed, 0) })
        .eq('id', currentSessionId);
      const { data } = await supabase
        .from('online_sessions')
        .insert([{ user_id: user.id, start_at: boundary }])
        .select()
        .single();
      if (data) {
        setCurrentSessionId(data.id);
        setSessionStartTs(nextReset.getTime());
        setSessionSeconds(0);
        todayOnlineBaseSecondsRef.current = 0;
        setTodayOnlineBaseSeconds(0);
      }
      fetchDataRef.current?.();
    }, msUntilReset);
    return () => clearTimeout(timer);
  }, [isOnline, dayResetHour, user?.id, currentSessionId, sessionStartTs]);

  const handleToggleOnlineRef = useRef<(() => void) | null>(null);

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
        setSessionStartTs(Date.now());
        setSessionSeconds(0);
        // Le compteur repart du cumul déjà en ligne aujourd'hui, pas de zéro :
        // une reprise après pause doit continuer le temps du jour. Hors du bloc
        // iOS ci-dessous — Android affiche le même compteur.
        const base = await fetchTodayOnlineBaseSeconds(user.id, dayResetHour);
        todayOnlineBaseSecondsRef.current = base;
        setTodayOnlineBaseSeconds(base);
        if (Platform.OS === 'ios' && ScanBridge) {
          if (ScanBridge.checkLiveActivityPermission) {
            const enabled = await ScanBridge.checkLiveActivityPermission();
            if (!enabled) {
              Alert.alert(
                t('dashboard.liveActivityPermission.title', 'Activités en direct'),
                t('dashboard.liveActivityPermission.message', 'Pour afficher le résultat des scans en temps réel, activez les Activités en direct dans Réglages → Strive.'),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('common.open'), onPress: () => Linking.openSettings() },
                ],
              );
            }
          }
          const accepted = rides.filter(r => r.status === 'ACCEPTED');
          const totalE = accepted.reduce((sum, r) => sum + effectiveFare(r), 0);
          const totalKm = accepted.reduce((sum, r) => sum + (r.distance_km || 0), 0);
          const onlineHrStart = todayOnlineBaseSecondsRef.current / 3600;
          ScanBridge.startLiveActivity({
            platform: 'IDLE',
            fare: 0, hourlyRate: 0, kmRate: 0,
            distanceKm: 0, durationMin: 0, verdictLevel: 1,
            todayEarnings: totalE,
            todayHourlyRate: onlineHrStart > 0 ? totalE / onlineHrStart : 0,
            todayKm: totalKm,
            onlineMinutes: Math.floor(todayOnlineBaseSecondsRef.current / 60),
            // Ancre du timer auto : maintenant − cumul déjà fait aujourd'hui
            // (la session courante démarre à 0).
            sessionStartEpoch: Math.floor(Date.now() / 1000) - todayOnlineBaseSecondsRef.current,
          });
        }
        if (ScanBridge?.setSessionOnline) ScanBridge.setSessionOnline(true);
        scheduleInactivityReminder();
      } else {
        if (currentSessionId) {
          await supabase
            .from('online_sessions')
            .update({ end_at: now, duration_seconds: sessionSeconds })
            .eq('id', currentSessionId);
        }
        setCurrentSessionId(null);
        setSessionStartTs(null);
        cancelInactivityReminder();
        if (Platform.OS === 'ios' && ScanBridge) {
          ScanBridge.stopLiveActivity();
          if (ScanBridge.setSessionOnline) ScanBridge.setSessionOnline(false);
        }
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

  handleToggleOnlineRef.current = handleToggleOnline;

  const fetchingRef = useRef(false);
  const fetchData = useCallback(async () => {
    if (!user?.id || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      setLoading(true);
      setFetchError(false);
      const { data: prefsData } = await supabase
        .from('preferences')
        .select('min_hourly_rate, min_km_rate, day_reset_hour, include_pickup, deduct_fuel')
        .eq('id', user.id)
        .maybeSingle();

      const resetHour = prefsData?.day_reset_hour === 4 ? 4 : 0;
      setDayResetHour(resetHour);
      const resetTime = getDayStart(resetHour);


      if (prefsData) {
        const minHourly = Number(String(prefsData.min_hourly_rate ?? '25').replace(',', '.'));
        const minKm = Number(String(prefsData.min_km_rate ?? '1.2').replace(',', '.'));
        // Tier free : seuils basiques IMPOSÉS (la personnalisation est un avantage
        // Plus) — on ignore toute valeur custom en base. Toutes les utilisations
        // en aval (verdict, push natif, tease) prennent donc le seuil forcé.
        const isFreeTier = tierRef.current === 'free';
        setPreferences({
          min_hourly_rate: isFreeTier ? FREE_THRESHOLDS.hourly : (Number.isFinite(minHourly) ? minHourly : 25),
          min_km_rate: isFreeTier ? FREE_THRESHOLDS.km : (Number.isFinite(minKm) ? minKm : 1.2),
          // Approche incluse par défaut : seul un choix explicite `false` la désactive.
          include_pickup: prefsData.include_pickup ?? true,
          deduct_fuel: prefsData.deduct_fuel ?? false,
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  // Re-fetch stats on every foreground resume (fetchData computes the correct day boundary)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchDataRef.current?.();
    });
    return () => sub.remove();
  }, []);

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
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 16 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >

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
                ? `${t('dashboard.online')}  ·  ${formatDuration(todayOnlineBaseSeconds + sessionSeconds)}`
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
              (dailyScans !== null
                ? `${t('dashboard.scans')}: ${stats.scans} / ${dailyScans}`
                : `${t('dashboard.scans')}: ${stats.scans}`)
              + (extraCredits > 0 ? ` (+${extraCredits})` : '')
            }
          >
            <Text style={styles.statLabel}>{t('dashboard.scans')}</Text>
            <Text style={styles.statValue}>
              {dailyScans !== null ? `${stats.scans}/${dailyScans}` : stats.scans}
              {extraCredits > 0 && (
                <Text style={styles.statCreditBonus}> +{extraCredits}</Text>
              )}
            </Text>
            <MaterialCommunityIcons name="qrcode-scan" size={32} color="rgba(0,230,118,0.25)" style={styles.statIcon} />
          </View>
        </View>


        {/* ── OFFLINE HINT ── */}
        {!isOnline && (
          <View style={styles.offlineHint}>
            <MaterialCommunityIcons name="line-scan" size={17} color="#FFB300" />
            <Text style={styles.offlineHintText}>
              {t('dashboard.offlineBanner', 'Passez en ligne pour activer le scanner')}
            </Text>
          </View>
        )}

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

        {/* ── PENDING SCANS HEADER ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('dashboard.pending')}</Text>
        </View>

        {/* ── SCAN LIMIT ── */}
        {!canScan && tier === 'plus' && (
          <View style={styles.scanLimitCard}>
            <Text style={styles.scanLimitTitle}>{t('dashboard.scanLimit.cardTitle')}</Text>
            <Text style={styles.scanLimitText}>{t('dashboard.scanLimit.comeBackTomorrow')}</Text>
          </View>
        )}
        {tier === 'free' && weeklyTease.state !== 'none' && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate('SubscriptionScreen')}
            style={[
              styles.teaseCard,
              weeklyTease.state === 'loss'
                ? { backgroundColor: 'rgba(255,77,79,0.08)', borderColor: 'rgba(255,77,79,0.35)' }
                : { backgroundColor: 'rgba(0,230,118,0.08)', borderColor: 'rgba(0,230,118,0.35)' },
            ]}
          >
            {weeklyTease.state === 'loss' ? (
              <>
                <Text style={styles.teaseTitle}>
                  {t('dashboard.weeklyTease.lossTitle', { eur: weeklyTease.lossWeek.toFixed(0) })}
                </Text>
                <Text style={styles.teaseSub}>
                  {t('dashboard.weeklyTease.lossSub', { eur: weeklyTease.lossMonth.toFixed(0) })}
                </Text>
                <Text style={styles.teaseCta}>{t('dashboard.weeklyTease.cta')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.teaseTitle}>
                  {t('dashboard.weeklyTease.prideTitle', { count: weeklyTease.avoided })}
                </Text>
                <Text style={styles.teaseCta}>{t('dashboard.weeklyTease.prideCta')}</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {!canScan && tier === 'free' && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate('SubscriptionScreen')}
            style={styles.upgradeCard}
          >
            <SafeGradient
              colors={['#0A2418', '#0E3020', '#122E1E']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.upgradeCardGradient}
            >
              <View style={styles.upgradeCardGlow} />
              <View style={styles.upgradeCardTop}>
                <View style={styles.upgradeCardBadge}>
                  <MaterialCommunityIcons name="crown" size={14} color="#062318" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.upgradeCardTitle}>{t('dashboard.upgradeCard.title', 'Arrête de rouler à perte')}</Text>
                  <Text style={styles.upgradeCardSub}>{t('dashboard.upgradeCard.sub', 'Plus se rembourse en une seule course évitée')}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.primary} />
              </View>
              <View style={styles.upgradeCardDivider} />
              <View style={styles.upgradeCardBottom}>
                <View style={styles.upgradeCardPerk}>
                  <Feather name="zap" size={12} color={colors.primary} />
                  <Text style={styles.upgradeCardPerkText}>{t('dashboard.upgradeCard.perk1', '15 scans/jour')}</Text>
                </View>
                <View style={styles.upgradeCardPerkDot} />
                <View style={styles.upgradeCardPerk}>
                  <Feather name="trending-up" size={12} color={colors.primary} />
                  <Text style={styles.upgradeCardPerkText}>{t('dashboard.upgradeCard.perk2', '€/h en direct')}</Text>
                </View>
                <View style={styles.upgradeCardPerkDot} />
                <View style={styles.upgradeCardPerk}>
                  <Feather name="clock" size={12} color={colors.primary} />
                  <Text style={styles.upgradeCardPerkText}>{t('dashboard.upgradeCard.perk3', 'Historique')}</Text>
                </View>
              </View>
            </SafeGradient>
          </TouchableOpacity>
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
        ) : !isOnline ? (
          <View style={styles.waitingContainer}>
            <MaterialCommunityIcons name="power-standby" size={36} color="rgba(255,255,255,0.15)" />
            <Text style={styles.waitingTitle}>{t('dashboard.offlineHint', 'Passez en ligne pour scanner')}</Text>
            <Text style={styles.waitingSubtitle}>{t('dashboard.offlineHintSub', 'Le scanner fonctionne uniquement quand vous êtes en ligne.')}</Text>
          </View>
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
              {t('dashboard.priceModal.subtitle', 'Entrez le montant final affiché')}
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
              placeholder={t('dashboard.priceModal.placeholder', 'Ex: 14.50')}
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
          <View style={styles.ratingCard}>
            <Text style={styles.ratingEmoji}>🚀</Text>
            <Text style={styles.ratingStars}>⭐⭐⭐⭐⭐</Text>
            <Text style={styles.ratingTitle}>
              {t('rating.title')}
            </Text>
            <Text style={styles.ratingMessage}>
              {t('rating.message')}
            </Text>
            <TouchableOpacity
              style={styles.ratingBtnPrimary}
              onPress={() => { setRatingModal(false); openStoreForRating(); }}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="star" size={18} color="#000" />
              <Text style={styles.ratingBtnPrimaryText}>
                {t('rating.rate')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ratingBtnSkip}
              onPress={() => setRatingModal(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.ratingBtnSkipText}>
                {t('rating.notNow')}
              </Text>
            </TouchableOpacity>
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
  statCreditBonus: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  statIcon: { position: 'absolute', top: 10, right: 10 },


  // SECTION HEADER
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { color: colors.textMain, fontSize: 20, fontWeight: '800' },

  // SCAN LIMIT (Plus tier — simple message)
  scanLimitCard: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 20,
    alignItems: 'center', marginBottom: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  scanLimitTitle: { color: colors.textMain, fontSize: 15, fontWeight: '800', marginBottom: 4, textAlign: 'center' },
  scanLimitText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  teaseCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 },
  teaseTitle: { color: colors.textMain, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  teaseSub: { color: colors.textMuted, fontSize: 13, marginBottom: 8 },
  teaseCta: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  // UPGRADE CARD (Free tier — premium upsell)
  upgradeCard: {
    marginBottom: 18, borderRadius: 18, overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#00E676', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14 },
      android: { elevation: 8 },
    }),
  },
  upgradeCardGradient: {
    borderRadius: 18, padding: 18,
    borderWidth: 1.5, borderColor: 'rgba(0,230,118,0.25)',
    overflow: 'hidden',
  },
  upgradeCardGlow: {
    position: 'absolute', top: -30, right: -30,
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(0,230,118,0.08)',
  },
  upgradeCardTop: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  upgradeCardBadge: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#00FF8C', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.6, shadowRadius: 8 },
      android: { elevation: 6 },
    }),
  },
  upgradeCardTitle: { color: colors.textMain, fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  upgradeCardSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  upgradeCardDivider: {
    height: 1, backgroundColor: 'rgba(0,230,118,0.12)',
    marginVertical: 14,
  },
  upgradeCardBottom: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
  },
  upgradeCardPerk: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  upgradeCardPerkText: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '600' },
  upgradeCardPerkDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.15)' },

  // WAITING
  waitingContainer: { alignItems: 'center', paddingVertical: 50, gap: 10 },
  waitingTitle: { color: colors.textDimmed, fontSize: 14 },
  waitingSubtitle: { color: colors.textDimmed, fontSize: 12, textAlign: 'center', maxWidth: 260, lineHeight: 18, opacity: 0.7 },



  // OFFLINE HINT
  offlineHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,179,0,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,179,0,0.2)',
    padding: 14,
    marginBottom: 12,
  },
  offlineHintText: {
    flex: 1,
    color: '#FFB300',
    fontSize: 13,
    fontWeight: '600',
  },

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
  ratingCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 28,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.15)',
  },
  ratingEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  ratingStars: {
    fontSize: 28,
    letterSpacing: 4,
    marginBottom: 16,
  },
  ratingTitle: {
    color: colors.textMain,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  ratingMessage: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 24,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  ratingBtnPrimary: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: '#FFD700',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  ratingBtnPrimaryText: {
    color: '#000',
    fontWeight: '800',
    fontSize: 16,
  },
  ratingBtnSkip: {
    marginTop: 14,
    paddingVertical: 10,
  },
  ratingBtnSkipText: {
    color: colors.textDimmed,
    fontWeight: '600',
    fontSize: 14,
  },
});

export default DashboardScreen;
