import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Animated,
  Easing,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import MapView, { Marker, Overlay, Polygon } from 'react-native-maps';
import Feather from 'react-native-vector-icons/Feather';
import SafeGradient from '../components/SafeGradient';
import MapSheet, { SheetNavButton } from '../components/MapSheet';
import GlassFill from '../components/GlassFill';
import { useAuth } from '../context/AuthContext';
import { useMarket } from '../hooks/useMarket';
import { useMarketT } from '../hooks/useMarketT';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { supabase } from '../services/supabase';
import { fetchCommunityLive, fetchRidePoints, type CommunityLive } from '../services/ridesService';
import { isHotZoneSimulationOn, simulateRidePoints } from '../services/simulatedZones';
import { normalizeRides } from '../services/fxService';
import { getEffectivePlanTier } from '../services/subscriptionService';
import { useTabBarInset } from '../navigation/useTabBarInset';
import { rideScoreColor } from '../utils/qualityScore';
import { formatMoney, toMarketRate, type CountryCode } from '../utils/market';
import { hapticSelection } from '../utils/haptics';
import {
  buildZones,
  framingBounds,
  H3_SPACING_M,
  zonesInView,
  FULL_CONFIDENCE,
  type LatLng,
  type LiveSpot,
  type LiveZone,
  type Region,
  type ZonePoint,
} from '../utils/zones';
import { renderHeatField } from '../utils/heatField';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { elevation, litEdge } from '../theme/elevation';
import { FIELD_TOP } from '../theme/field';

const BOLT = require('../assets/icons/zone-bolt.png');
/** Repère posé sur la carte : petit, comme celui des applis VTC — il signale,
 *  le halo montre. Le grand badge reste dans la fiche. */
const BOLT_PIN = require('../assets/icons/zone-bolt-pin.png');

/** Fenêtre lue pour « Mes courses », en jours. */
const WINDOW_DAYS = 90;

/** Rafraîchissement du direct tant que l'écran est ouvert. */
const LIVE_REFRESH_MS = 60_000;

/**
 * Cadre d'ouverture tant qu'aucune course n'est placée : la grande ville du
 * marché, à l'échelle d'une agglomération. Ensuite la carte se cale sur les
 * départs du chauffeur.
 */
const MARKET_CENTERS: Record<CountryCode, Region> = {
  FR: { latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.16, longitudeDelta: 0.16 },
  BE: { latitude: 50.8503, longitude: 4.3517, latitudeDelta: 0.16, longitudeDelta: 0.16 },
  CH: { latitude: 46.2044, longitude: 6.1432, latitudeDelta: 0.16, longitudeDelta: 0.16 },
  ES: { latitude: 40.4168, longitude: -3.7038, latitudeDelta: 0.16, longitudeDelta: 0.16 },
  PT: { latitude: 38.7223, longitude: -9.1393, latitudeDelta: 0.16, longitudeDelta: 0.16 },
  GB: { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.16, longitudeDelta: 0.16 },
};

/** Zone sans taux exploitable (ni distance ni durée) : présente, mais muette. */
const NEUTRAL_RGB = '255,255,255';

/** Part de la hauteur visible dont la carte remonte quand une fiche s'ouvre :
 *  la zone touchée reste au-dessus de la fiche au lieu de passer dessous. */
const SHEET_LIFT = 0.2;

/** Au-delà, pas d'étiquettes de tarif : à cette échelle elles se chevauchent
 *  et des centaines de vues natives ralentiraient la carte. */
const MAX_LABELS = 80;
/** Taille minimale d'un hexagone à l'écran, en points, pour y écrire son tarif. */
const MIN_LABEL_HEX_PT = 40;
/** En dessous, la carte reste ouverte mais invite à scanner : quelques points
 *  épars ne dessinent pas encore de zones lisibles. */
const MIN_POINTS_FOR_ZONES = 5;
/** Hauteur de la ligne logo Plans + « Mentions légales » de MapKit. */
const LEGAL_ROW_H = 22;

/**
 * Carte en direct : masquée pour l'instant, l'onglet ne montre que « Mes
 * courses ». Tout le code reste (Edge Function `community-live`, champ de
 * chaleur, éclairs) ; repasser à `true` remet le sélecteur.
 */
const LIVE_MAP_ENABLED = false;

/** Le serveur refuse une emprise plus large (cf. community_live). */
const MAX_HALF_LAT = 1.49;
const MAX_HALF_LON = 1.99;

/** Apparition des zones, découpée en pas : un overlay natif ne s'anime pas,
 *  on rejoue donc son alpha quelques fois. */
const REVEAL_STEPS = 6;
const REVEAL_STEP_MS = 40;

type Mode = 'mine' | 'live';

/** « #00E676 » + alpha → « rgba(0,230,118,a) ». */
function withAlpha(hex: string, alpha: number): string {
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${channel(1)},${channel(3)},${channel(5)},${alpha.toFixed(3)})`;
}

type Bounds = { minLat: number; minLon: number; maxLat: number; maxLon: number };

/** L'emprise demandée au serveur : l'écran plus une demi-largeur de chaque
 *  côté, pour qu'un petit déplacement ne relance pas d'appel. */
function fetchBounds(r: Region): Bounds {
  const hLat = Math.min(r.latitudeDelta, MAX_HALF_LAT);
  const hLon = Math.min(r.longitudeDelta, MAX_HALF_LON);
  return {
    minLat: r.latitude - hLat,
    maxLat: r.latitude + hLat,
    minLon: r.longitude - hLon,
    maxLon: r.longitude + hLon,
  };
}

function covers(b: Bounds, r: Region): boolean {
  return (
    r.latitude - r.latitudeDelta / 2 >= b.minLat &&
    r.latitude + r.latitudeDelta / 2 <= b.maxLat &&
    r.longitude - r.longitudeDelta / 2 >= b.minLon &&
    r.longitude + r.longitudeDelta / 2 <= b.maxLon
  );
}

/** Un polygone natif ne s'anime pas : la sélection rejoue ses coins à ce pas,
 *  dans son propre composant pour ne redessiner qu'elle. */
const GLOW_FRAME_MS = 50;
/** La case choisie grossit un instant puis se pose. */
const POP_SCALES = [0.86, 0.96, 1.04, 1.06, 1.03, 1];
/** Une onde toutes les 2 s : elle s'étend pendant 1,4 s, puis repos. */
const RING_PERIOD_MS = 2000;
const RING_ACTIVE_MS = 1400;
const RING_MAX_SCALE = 1.9;
const TRANSPARENT = 'rgba(0,0,0,0)';

function scaleCorners(corners: LatLng[], center: LatLng, s: number): LatLng[] {
  return corners.map(p => ({
    latitude: center.latitude + (p.latitude - center.latitude) * s,
    longitude: center.longitude + (p.longitude - center.longitude) * s,
  }));
}

/**
 * La case sélectionnée : halo de sa couleur, contour blanc qui se pose, et
 * une onde qui en part tant qu'elle reste choisie. Montée avec `key` = la
 * case, pour que chaque sélection rejoue l'arrivée. Hors de l'onglet ou avec
 * « Réduire les animations », tout reste immobile.
 */
const SelectionGlow = ({ corners, center, color }: { corners: LatLng[]; center: LatLng; color: string }) => {
  const reduceMotion = useReduceMotion();
  const focused = useIsFocused();
  const [frame, setFrame] = useState(reduceMotion ? -1 : 0);
  useEffect(() => {
    if (reduceMotion || !focused) return;
    const timer = setInterval(() => setFrame(f => f + 1), GLOW_FRAME_MS);
    return () => clearInterval(timer);
  }, [reduceMotion, focused]);

  const still = frame < 0;
  const pop = still ? 1 : POP_SCALES[Math.min(frame, POP_SCALES.length - 1)];
  const t = still ? RING_PERIOD_MS : (frame * GLOW_FRAME_MS) % RING_PERIOD_MS;
  const p = Math.min(1, t / RING_ACTIVE_MS);
  const ease = 1 - (1 - p) * (1 - p);
  const ringAlpha = 0.7 * (1 - ease);
  // Le halo respire au rythme de l'onde.
  const breath = still ? 1 : 0.8 + 0.2 * Math.cos((2 * Math.PI * t) / RING_PERIOD_MS);
  const lifted = pop === 1 ? corners : scaleCorners(corners, center, pop);

  return (
    <>
      <Polygon coordinates={lifted} fillColor={TRANSPARENT} strokeColor={withAlpha(color, 0.14 * breath)} strokeWidth={16} zIndex={3} />
      <Polygon coordinates={lifted} fillColor={TRANSPARENT} strokeColor={withAlpha(color, 0.3 * breath)} strokeWidth={8} zIndex={3} />
      {ringAlpha > 0.01 && (
        <Polygon
          coordinates={scaleCorners(corners, center, 1 + (RING_MAX_SCALE - 1) * ease)}
          fillColor={TRANSPARENT}
          strokeColor={withAlpha(color, ringAlpha)}
          strokeWidth={2.5}
          zIndex={3}
        />
      )}
      <Polygon coordinates={lifted} fillColor={TRANSPARENT} strokeColor={colors.textMain} strokeWidth={3} zIndex={4} />
    </>
  );
};

/** Point rouge qui respire : le signe universel du direct. */
const LiveDot = () => {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return (
    <View style={styles.liveDotWrap}>
      <Animated.View
        style={[
          styles.liveDotRing,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
          },
        ]}
      />
      <View style={styles.liveDot} />
    </View>
  );
};

/** Interrupteur à deux positions dont la pastille glisse d'un côté à l'autre. */
const ModeSwitch = ({
  mode,
  onChange,
  locked,
  labels,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  locked: boolean;
  labels: [string, string];
}) => {
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  const pos = useRef(new Animated.Value(mode === 'live' ? 1 : 0)).current;

  useEffect(() => {
    const to = mode === 'live' ? 1 : 0;
    if (reduceMotion) {
      pos.setValue(to);
      return;
    }
    Animated.spring(pos, {
      toValue: to,
      useNativeDriver: true,
      damping: 18,
      stiffness: 220,
      mass: 0.8,
    }).start();
  }, [mode, pos, reduceMotion]);

  const half = width / 2 - 3;
  const translateX = pos.interpolate({ inputRange: [0, 1], outputRange: [0, half] });

  return (
    <View
      style={styles.switch}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {width > 0 && (
        <Animated.View style={[styles.switchThumb, { width: half, transform: [{ translateX }] }]} />
      )}
      {(['mine', 'live'] as const).map((m, idx) => {
        const active = mode === m;
        return (
          <Pressable
            key={m}
            style={styles.switchItem}
            onPress={() => {
              if (active) return;
              hapticSelection();
              onChange(m);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            {m === 'live' &&
              (locked ? (
                <Feather name="lock" size={12} color={active ? colors.textMain : colors.textDimmed} />
              ) : (
                <LiveDot />
              ))}
            <Text style={[styles.switchText, active && styles.switchTextActive]} numberOfLines={1}>
              {labels[idx]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const MapScreen = () => {
  const { t } = useMarketT();
  const market = useMarket();
  const navigation = useNavigation<any>();
  const { user, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  // Zones chaudes simulées (Diagnostics) : comptes admin seulement. Elles
  // ouvrent aussi le direct à un compte admin gratuit, pour pouvoir tester.
  const canSimulate = __DEV__ || !!profile?.is_admin;
  const [simZones, setSimZones] = useState(false);
  const simRef = useRef(false);
  simRef.current = simZones;
  const isPaid = getEffectivePlanTier(profile) !== 'free' || simZones;

  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  const [region, setRegion] = useState<Region>(MARKET_CENTERS[market.country]);
  // L'écran s'ouvre sur le direct : c'est ce qu'on vient y chercher en roulant.
  const [mode, setMode] = useState<Mode>(LIVE_MAP_ENABLED ? 'live' : 'mine');

  const [points, setPoints] = useState<ZonePoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [thresholds, setThresholds] = useState({
    minHourly: market.thresholds.hourly,
    minKm: market.thresholds.distance,
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [live, setLive] = useState<{ data: CommunityLive; bounds: Bounds; at: Date } | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);
  const [openSpot, setOpenSpot] = useState<LatLng | null>(null);
  const [openZone, setOpenZone] = useState<LiveZone | null>(null);
  const [focused, setFocused] = useState(false);

  /// Hauteurs mesurées du titre et de la carte d'info : la carte du monde passe
  /// SOUS les deux, il faut les connaître pour cadrer et pour garder visibles le
  /// logo Plans et ses mentions légales.
  const [headerH, setHeaderH] = useState(0);
  const [cardH, setCardH] = useState(0);
  // La carte parle seule : la carte d'info ne sert plus qu'au verrou (free),
  // à l'erreur de chargement et à un historique encore trop maigre.
  const showCard =
    mode === 'live'
      ? !isPaid || (liveFailed && !live)
      : (failed && !points) || (!!points && points.length < MIN_POINTS_FOR_ZONES);
  useEffect(() => {
    if (!showCard) setCardH(0);
  }, [showCard]);
  // Hauteur réelle de la barre d'onglets native (Liquid Glass) : la carte de
  // la fiche et le cadrage passent au-dessus.
  const clearance = useTabBarInset();
  // Le logo Plans et « Mentions légales » toujours juste au-dessus de la barre
  // d'onglets ; la carte d'info, quand elle s'affiche, passe au-dessus d'eux.
  const logoBottom = clearance + space.xs;
  const cardBottom = logoBottom + LEGAL_ROW_H + space.sm;
  const mapPadding = {
    top: insets.top + headerH,
    bottom: cardBottom + cardH + space.sm,
    left: 0,
    right: 0,
  };

  const loadingRef = useRef(false);
  const load = useCallback(async () => {
    if (!user?.id || loadingRef.current) return;
    loadingRef.current = true;
    setFailed(false);
    try {
      // Borne haute un jour plus loin : une course scannée à l'instant ne doit
      // pas tomber hors de la fenêtre pour une seconde d'écart d'horloge.
      if (simRef.current) {
        // Simulation admin : un mois de courses inventées autour de la vue.
        setPoints(simulateRidePoints(regionRef.current));
        return;
      }
      const end = new Date(Date.now() + 24 * 3600 * 1000);
      const start = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
      const [rows, prefs] = await Promise.all([
        fetchRidePoints(user.id, start, end),
        supabase
          .from('preferences')
          .select('min_hourly_rate, min_km_rate')
          .eq('id', user.id)
          .single(),
      ]);
      // Les seuils sont dans la devise du chauffeur : une course d'une autre
      // monnaie y est ramenée avant d'être comparée.
      const normalized = await normalizeRides(rows, market.currency);
      // Seuils imposés en free, comme au scan et dans l'Historique : une zone
      // ne doit pas être verte ici sur des seuils que le verdict n'applique pas.
      setThresholds({
        minHourly: isPaid
          ? Number(prefs.data?.min_hourly_rate ?? market.thresholds.hourly) || market.thresholds.hourly
          : market.thresholds.hourly,
        minKm: isPaid
          ? Number(prefs.data?.min_km_rate ?? market.thresholds.distance) || market.thresholds.distance
          : market.thresholds.distance,
      });
      setPoints(
        normalized.map(r => ({
          lat: Number(r.pickup_lat),
          lon: Number(r.pickup_lon),
          fare: Number(r.fare_final ?? r.fare_estimated) || 0,
          distanceKm: Number(r.distance_km) || 0,
          durationMin: Number(r.duration_min) || 0,
          address: r.pickup_address,
        })),
      );
    } catch {
      setFailed(true);
    } finally {
      loadingRef.current = false;
    }
  }, [user?.id, isPaid, market.currency, market.thresholds.hourly, market.thresholds.distance]);

  // Relu à chaque retour sur l'onglet : les courses scannées entre-temps doivent
  // y apparaître sans geste de rafraîchissement.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      // L'interrupteur vit dans Diagnostics : relu à chaque retour sur la
      // carte, AVANT le chargement, qui en dépend.
      isHotZoneSimulationOn().then(on => {
        simRef.current = on && canSimulate;
        setSimZones(simRef.current);
        load();
      });
      return () => setFocused(false);
    }, [load, canSimulate]),
  );

  // Cadrage sur les départs du chauffeur, UNE fois : relu au retour sur
  // l'onglet, il ramènerait la carte en arrière sous le doigt de quelqu'un qui
  // venait de zoomer sur un quartier.
  const framedRef = useRef(false);
  useEffect(() => {
    if (framedRef.current || !mapReady || !points || (showCard && cardH === 0)) return;
    const bounds = framingBounds(points);
    if (!bounds) return;
    framedRef.current = true;
    mapRef.current?.fitToCoordinates(bounds, {
      edgePadding: {
        top: mapPadding.top + space.lg,
        bottom: mapPadding.bottom + space.lg,
        left: space.xl,
        right: space.xl,
      },
      animated: false,
    });
  }, [mapReady, points, cardH, showCard, mapPadding.top, mapPadding.bottom]);

  // ─── Direct ────────────────────────────────────────────────────────────────
  const requestRef = useRef(0);
  const regionRef = useRef(region);
  regionRef.current = region;
  const loadLive = useCallback(async () => {
    const id = ++requestRef.current;
    setLiveFailed(false);
    try {
      const bounds = fetchBounds(regionRef.current);
      const data = await fetchCommunityLive(bounds, { simulate: simRef.current });
      if (id !== requestRef.current) return;
      setLive({ data, bounds, at: new Date() });
    } catch {
      if (id === requestRef.current) setLiveFailed(true);
    }
  }, []);

  const liveActive = mode === 'live' && isPaid && focused;

  // Toutes les minutes tant que l'écran est ouvert : le direct qui ne bouge pas
  // n'en est plus un.
  useEffect(() => {
    if (!liveActive) return;
    loadLive();
    const timer = setInterval(loadLive, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [liveActive, loadLive, simZones]);

  // Et dès que la vue sort de ce qui a été chargé.
  const liveBounds = live?.bounds;
  useEffect(() => {
    if (!liveActive || !liveBounds || covers(liveBounds, region)) return;
    // Laisse le geste se terminer : un pincement enchaîne plusieurs régions.
    const timer = setTimeout(loadLive, 250);
    return () => clearTimeout(timer);
  }, [liveActive, liveBounds, region, loadLive]);

  // ─── Zones de « Mes courses » ──────────────────────────────────────────────
  const ownZones = useMemo(
    () => (points ? buildZones(points, thresholds) : []),
    [points, thresholds],
  );
  const visible = useMemo(
    () => (mode === 'mine' ? zonesInView(ownZones, region) : []),
    [mode, ownZones, region],
  );
  const selected = selectedKey ? ownZones.find(z => z.key === selectedKey) ?? null : null;
  // Largeur d'un hexagone à l'écran : sous ~46 pt, son tarif ne s'y lit plus,
  // on n'écrit rien plutôt que de superposer des chiffres.
  const { width: screenW } = useWindowDimensions();
  const hexPt =
    (H3_SPACING_M / (region.longitudeDelta * 111_320 * Math.cos((region.latitude * Math.PI) / 180))) * screenW;
  const showLabels = hexPt >= MIN_LABEL_HEX_PT && visible.length <= MAX_LABELS;
  const spots: LiveSpot[] = mode === 'live' && isPaid && live ? live.data.spots : [];
  const liveZones: LiveZone[] = mode === 'live' && isPaid && live ? live.data.zones : [];

  // Le champ de chaleur n'est recalculé qu'à l'arrivée de nouvelles données
  // (toutes les minutes, ou quand la vue sort de l'emprise chargée).
  const heat = useMemo(
    () =>
      live && mode === 'live' && isPaid
        ? renderHeatField(live.data.spots, live.bounds, {
            minRides: live.data.minRides,
            hotRides: live.data.hotRides,
          })
        : null,
    [live, mode, isPaid],
  );

  // ─── Apparition en fondu à chaque nouveau jeu de zones ─────────────────────
  const dataStamp =
    mode === 'mine'
      ? `mine:${points?.length ?? -1}`
      : `live:${live?.at.getTime() ?? 0}`;
  const [reveal, setReveal] = useState(1);
  useEffect(() => {
    if (reduceMotion) {
      setReveal(1);
      return;
    }
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      step += 1;
      setReveal(step / REVEAL_STEPS);
      if (step < REVEAL_STEPS) timer = setTimeout(tick, REVEAL_STEP_MS);
    };
    setReveal(0);
    timer = setTimeout(tick, REVEAL_STEP_MS);
    return () => clearTimeout(timer);
  }, [dataStamp, reduceMotion]);

  // ─── Sélection : les autres cases s'éteignent en fondu, pas d'un coup ─────
  const hasSelection = selectedKey != null;
  const [dimT, setDimT] = useState(0);
  const dimRef = useRef(0);
  useEffect(() => {
    const target = hasSelection ? 1 : 0;
    if (reduceMotion) {
      dimRef.current = target;
      setDimT(target);
      return;
    }
    const from = dimRef.current;
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      step += 1;
      dimRef.current = from + (target - from) * (step / REVEAL_STEPS);
      setDimT(dimRef.current);
      if (step < REVEAL_STEPS) timer = setTimeout(tick, REVEAL_STEP_MS);
    };
    timer = setTimeout(tick, REVEAL_STEP_MS);
    return () => clearTimeout(timer);
  }, [hasSelection, reduceMotion]);

  // ─── Carte d'info : glisse et se fond à chaque changement de contenu ──────
  const cardKey = `${mode}:${selectedKey ?? ''}:${points ? 'p' : '-'}:${live ? 'l' : '-'}:${spots.length > 0}`;
  const cardAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) return;
    cardAnim.setValue(0);
    Animated.timing(cardAnim, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [cardKey, cardAnim, reduceMotion]);
  const cardContentStyle = {
    opacity: cardAnim,
    transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  };

  /** Centre la zone dans la partie de carte qui reste visible au-dessus de la
   *  fiche. */
  const focusAboveSheet = (center: LatLng) => {
    mapRef.current?.animateCamera(
      { center: { latitude: center.latitude - region.latitudeDelta * SHEET_LIFT, longitude: center.longitude } },
      { duration: reduceMotion ? 0 : 380 },
    );
  };

  const selectHex = (key: string) => {
    const zone = ownZones.find(z => z.key === key);
    if (!zone) return;
    hapticSelection();
    setSelectedKey(key);
    focusAboveSheet(zone.center);
  };

  const closeSheet = () => {
    setOpenSpot(null);
    setOpenZone(null);
    setSelectedKey(null);
  };

  const changeMode = (m: Mode) => {
    setSelectedKey(null);
    setOpenSpot(null);
    setOpenZone(null);
    setMode(m);
  };

  const openDemand = (z: LiveZone) => {
    hapticSelection();
    const center = { latitude: Number(z.lat), longitude: Number(z.lon) };
    setOpenZone(z);
    setOpenSpot(center);
    focusAboveSheet(center);
  };

  // Les étiquettes de tarif sont des vues natives figées en image : on les
  // laisse se redessiner un instant après chaque changement, puis on fige.
  const [labelsTracking, setLabelsTracking] = useState(true);
  useEffect(() => {
    setLabelsTracking(true);
    const timer = setTimeout(() => setLabelsTracking(false), 600);
    return () => clearTimeout(timer);
  }, [visible, selectedKey]);

  const money = (n: number) => formatMoney(n, market, { decimals: 2 });
  const perKm = (n: number) => t('zones.perDistance', { amount: money(toMarketRate(n, market)) });

  const renderLiveCard = () => {
    if (!isPaid) {
      return (
        <>
          <View style={styles.row}>
            <Image source={BOLT} style={styles.cardBadge} />
            <Text style={[styles.cardTitle, styles.flex]}>{t('zones.lockedTitle')}</Text>
          </View>
          <Text style={styles.cardBody}>{t('zones.lockedBody')}</Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => navigation.navigate('SubscriptionScreen')}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>{t('zones.lockedCta')}</Text>
          </TouchableOpacity>
        </>
      );
    }
    if (!live) {
      return liveFailed ? (
        <View style={styles.row}>
          <Feather name="alert-circle" size={18} color={colors.danger} />
          <Text style={[styles.cardBody, styles.flex]}>{t('errors.loadFailed')}</Text>
          <TouchableOpacity onPress={loadLive} hitSlop={8}>
            <Text style={styles.retry}>{t('errors.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : null;
    }
    return null;
  };

  const renderMineCard = () => {
    if (!points) {
      return failed ? (
        <View style={styles.row}>
          <Feather name="alert-circle" size={18} color={colors.danger} />
          <Text style={[styles.cardBody, styles.flex]}>{t('errors.loadFailed')}</Text>
          <TouchableOpacity onPress={load} hitSlop={8}>
            <Text style={styles.retry}>{t('errors.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : null;
    }
    return (
      <>
        <Text style={styles.cardTitle}>{t('zones.empty')}</Text>
        <Text style={styles.cardBody}>{t('zones.emptyHint')}</Text>
      </>
    );
  };

  const sheetTarget = mode === 'live' ? openSpot : selected?.center ?? null;

  const renderSheet = () => {
    if (mode === 'live') {
      return (
        <>
          <View style={styles.sheetTitleRow}>
            <View style={styles.flex}>
              <Text style={styles.sheetTitle}>{t('zones.sheetTitle')}</Text>
              {/* À la place de la distance chez Uber : ce que la zone a
                  vraiment produit dans l'heure. */}
              <Text style={styles.sheetSubtitle}>
                {openZone
                  ? t('zones.sheetHourCount', { count: openZone.rides_hour })
                  : t('zones.sheetSubtitle')}
              </Text>
            </View>
            <Image source={BOLT} style={styles.sheetBadge} />
          </View>
          {openSpot && <SheetNavButton to={openSpot} />}
          <View style={styles.sheetInfoRow}>
            <Feather name="map-pin" size={18} color={colors.textMuted} style={styles.sheetInfoIcon} />
            <Text style={styles.sheetInfo}>{t('zones.sheetInfo')}</Text>
          </View>
        </>
      );
    }
    if (!selected) return null;
    const score = selected.score;
    const color = score != null ? rideScoreColor(score) : `rgba(${NEUTRAL_RGB},0.5)`;
    // Mêmes seuils que la couleur de l'hexagone (rideScoreColor) : la fiche dit
    // en mots ce que la carte dit en couleur.
    const verdictKey = score == null ? null : score >= 70 ? 'verdictGood' : score >= 45 ? 'verdictMid' : 'verdictBad';
    const stats = [
      { key: 'statRides', icon: 'navigation', value: String(selected.rides) },
      {
        key: 'statHourly',
        icon: 'clock',
        value: selected.hourlyRate != null ? t('zones.perHour', { amount: money(selected.hourlyRate) }) : '—',
      },
      { key: 'statKm', icon: 'trending-up', value: selected.kmRate != null ? perKm(selected.kmRate) : '—' },
    ];
    return (
      <>
        <View style={styles.sheetTitleRow}>
          <View style={styles.flex}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {selected.label ?? t('zones.zoneFallback')}
            </Text>
            <Text style={styles.sheetSubtitle}>{t('zones.zoneSheetSubtitle', { days: WINDOW_DAYS })}</Text>
          </View>
          {/* La case elle-même, à sa couleur : on voit de quel hexagone on parle. */}
          <Feather name="hexagon" size={34} color={color} />
        </View>
        {verdictKey && score != null && (
          <View
            style={[
              styles.verdict,
              { backgroundColor: withAlpha(color, 0.14), borderColor: withAlpha(color, 0.5) },
            ]}
          >
            <View style={[styles.verdictDot, { backgroundColor: color }]} />
            <Text style={[styles.verdictText, { color }]}>{t(`zones.${verdictKey}`)}</Text>
            <Text style={styles.verdictScore}>{Math.round(score)}/100</Text>
          </View>
        )}
        <View style={styles.stats}>
          {stats.map(st => (
            <View key={st.key} style={styles.stat}>
              <Feather name={st.icon as any} size={16} color={colors.textMuted} />
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                {st.value}
              </Text>
              <Text style={styles.statLabel}>{t(`zones.${st.key}`)}</Text>
            </View>
          ))}
        </View>
      </>
    );
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={MARKET_CENTERS[market.country]}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={r => setRegion(r)}
        mapPadding={mapPadding}
        // Le logo Plans et « Mentions légales » restent en bas à gauche, où
        // MapKit les pose, mais juste au-dessus de la barre d'onglets plutôt
        // qu'au-dessus de toute la marge du bas. Seule la hauteur est imposée :
        // MapKit garde leur position horizontale, côte à côte, quelle que soit
        // la longueur du mot « Plans » dans la langue du téléphone (un 0 n'est
        // pas imposé, côté natif).
        appleLogoInsets={{ top: 0, left: 0, right: 0, bottom: logoBottom }}
        legalLabelInsets={{ top: 0, left: 0, right: 0, bottom: logoBottom }}
        // Plan sombre et atténué : il porte les zones au lieu de leur disputer
        // l'attention, et il prolonge le fond de l'app au lieu de trouer l'écran.
        userInterfaceStyle="dark"
        mapType="mutedStandard"
        showsPointsOfInterests={false}
        showsBuildings={false}
        showsCompass={false}
        pitchEnabled={false}
        rotateEnabled={false}
        loadingEnabled
        loadingBackgroundColor={colors.background}
        loadingIndicatorColor={colors.primary}
      >
        {visible.map(z => {
          const isSelected = z.key === selectedKey;
          // Une zone choisie : elle passe devant, les autres s'effacent à moitié
          // — on voit de quel hexagone parle la fiche.
          const dim = isSelected ? 1 : 1 - 0.6 * dimT;
          const confidence = Math.min(1, z.rides / FULL_CONFIDENCE);
          const base = z.score != null ? rideScoreColor(z.score) : null;
          const fillA = (isSelected ? 0.62 : 0.14 + 0.46 * confidence) * reveal * dim;
          const fill = base
            ? withAlpha(base, fillA)
            : `rgba(${NEUTRAL_RGB},${((0.06 + 0.1 * confidence) * reveal * dim).toFixed(3)})`;
          // Contour franc : chaque hexagone se lit comme une case, pas comme une tache.
          const edge = base
            ? withAlpha(base, (0.55 + 0.4 * confidence) * reveal * dim)
            : `rgba(${NEUTRAL_RGB},${(0.3 * reveal * dim).toFixed(3)})`;
          return (
            <Polygon
              key={z.key}
              coordinates={z.corners}
              fillColor={fill}
              // Le contour blanc de la case choisie vient de SelectionGlow.
              strokeColor={edge}
              strokeWidth={1.5}
              zIndex={isSelected ? 2 : 1}
              tappable
              onPress={() => selectHex(z.key)}
            />
          );
        })}
        {selected && (
          <SelectionGlow
            key={selected.key}
            corners={selected.corners}
            center={selected.center}
            color={selected.score != null ? rideScoreColor(selected.score) : colors.textMain}
          />
        )}
        {showLabels &&
          visible.map(z =>
            z.kmRate == null ? null : (
              <Marker
                key={`l:${z.key}`}
                coordinate={z.center}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={labelsTracking}
                onPress={() => selectHex(z.key)}
              >
                <View style={[styles.hexLabel, { opacity: reveal }]}>
                  <Text style={styles.hexRate}>{money(toMarketRate(z.kmRate, market))}</Text>
                  <Text style={styles.hexUnit}>{t('zones.perDistance', { amount: '' })}</Text>
                </View>
              </Marker>
            ),
          )}

        {heat && live && (
          <Overlay
            image={{ uri: heat.uri }}
            // Nord-est puis sud-ouest.
            bounds={[
              [live.bounds.maxLat, live.bounds.maxLon],
              [live.bounds.minLat, live.bounds.minLon],
            ]}
          />
        )}
        {/* Un éclair par zone, sur sa cellule la plus chaude — comme Uber :
            un disque translucide, le petit éclair Strive au centre. */}
        {liveZones.map(z => (
          <Marker
            key={`z:${z.lat}:${z.lon}`}
            coordinate={{ latitude: Number(z.lat), longitude: Number(z.lon) }}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => openDemand(z)}
            tracksViewChanges={false}
          >
            <View style={styles.boltHalo}>
              <Image source={BOLT_PIN} style={styles.boltPin} />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Le haut de l'écran s'enfonce dans la même couleur que les autres
          onglets : le titre se lit sur la carte sans bandeau opaque. */}
      <SafeGradient
        colors={[FIELD_TOP, 'rgba(7,12,9,0)']}
        style={[styles.scrim, { height: insets.top + headerH + space.xl }]}
        pointerEvents="none"
      />
      <View
        style={[styles.header, { paddingTop: insets.top + space.lg }]}
        pointerEvents="box-none"
        onLayout={e => setHeaderH(e.nativeEvent.layout.height - insets.top)}
      >
        <View style={styles.titleRow}>
          <Text style={styles.headerTitle}>{t('zones.title')}</Text>
          {/* Jamais confondre une démo avec le vrai direct. */}
          {simZones && (
            <View style={styles.simBadge}>
              <Text style={styles.simBadgeText}>{t('zones.simulated', 'Simulation')}</Text>
            </View>
          )}
        </View>
        {LIVE_MAP_ENABLED && (
          <ModeSwitch
            mode={mode}
            onChange={changeMode}
            locked={!isPaid}
            labels={[t('zones.modeMine'), t('zones.modeLive')]}
          />
        )}
      </View>

      {showCard && (
        <View
          style={[styles.card, { bottom: cardBottom }]}
          onLayout={e => setCardH(e.nativeEvent.layout.height)}
        >
          <GlassFill corners={styles.cardCorners} />
          <Animated.View style={reduceMotion ? undefined : cardContentStyle}>
            {mode === 'live' ? renderLiveCard() : renderMineCard()}
          </Animated.View>
        </View>
      )}

      <MapSheet target={sheetTarget} onClose={closeSheet}>
        {renderSheet()}
      </MapSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FIELD_TOP },
  flex: { flex: 1 },

  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
  },
  headerTitle: { color: colors.textMain, fontSize: 20, fontWeight: 'bold' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  simBadge: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: 999,
    backgroundColor: 'rgba(255,152,0,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,152,0,0.6)',
  },
  simBadgeText: { color: '#FF9800', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },

  switch: {
    flexDirection: 'row',
    marginTop: space.md,
    padding: 3,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  switchThumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    borderRadius: radius.full,
    backgroundColor: elevation.floating.surface,
    ...litEdge('floating'),
  },
  switchItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  switchText: { color: colors.textDimmed, fontSize: 13, fontWeight: '600' },
  switchTextActive: { color: colors.textMain, fontWeight: '700' },

  liveDotWrap: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: '#FF3B30' },
  liveDotRing: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: '#FF3B30',
  },

  cardBadge: { width: 28, height: 28 },

  // Le tarif au km, posé directement sur la zone, sans fond : du blanc gras et
  // une ombre douce suffisent à le lire sur le vert, le rouge et les rues.
  hexLabel: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  hexRate: {
    color: colors.textMain,
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  hexUnit: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  card: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    ...elevation.floating.shadow,
  },
  cardCorners: { borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardTitle: { color: colors.textMain, fontSize: 16, fontWeight: '700' },
  cardBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: space.xs,
  },
  retry: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  /** Disque de l'éclair : l'indigo translucide d'Uber, autour du petit éclair. */
  boltHalo: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(98,82,236,0.42)',
  },
  boltPin: { width: 28, height: 28 },
  sheetTitle: { color: colors.textMain, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  sheetSubtitle: { color: colors.textMuted, fontSize: 15, marginTop: space.xs },
  sheetBadge: { width: 52, height: 52 },
  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
    marginTop: space.lg,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  verdictDot: { width: 8, height: 8, borderRadius: radius.full },
  verdictText: { fontSize: 15, fontWeight: '800' },
  verdictScore: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sheetInfoRow: { flexDirection: 'row', gap: space.lg, marginTop: space.xl },
  sheetInfoIcon: { marginTop: 2 },
  sheetInfo: { flex: 1, color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
  stat: {
    flex: 1,
    paddingVertical: space.lg,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    gap: space.xs,
  },
  statValue: {
    color: colors.textMain,
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: space.xs },

  cta: {
    marginTop: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  ctaText: { color: '#04140B', fontSize: 15, fontWeight: '800' },
});

export default MapScreen;
