// « Événements et perturbations » — ouvert depuis la carte d'Historique.
//
// Deux onglets :
//   · Perturbations : ce qui pousse des voyageurs vers les VTC MAINTENANT —
//     transports coupés ou en grève, vagues de trains grandes lignes.
//   · Événements : matchs, concerts, festivals et salons des 2 prochains mois.
//
// Rien n'est prédit ici : chaque ligne vient d'une source publique, lue dans
// `city_signals` (edge function `city-pulse`).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  LayoutAnimation,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { FIELD_TOP } from '../theme/field';
import ScreenField from '../components/ScreenField';
import SafeGradient from '../components/SafeGradient';
import AnimatedEntrance from '../components/AnimatedEntrance';
import BrandLoader from '../components/BrandLoader';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { hapticSelection, hapticLight } from '../utils/haptics';
import {
  CITIES,
  City,
  CitySignal,
  fetchCitySignals,
  isCurrent,
  isDisruption,
  loadCity,
  saveCity,
} from '../services/cityPulseService';

// Ambre : une perturbation demande l'attention, pas l'alarme (le rouge reste
// réservé aux vraies erreurs).
const ALERT_TINT = '#FFB547';
const CITY_LABEL: Record<City, string> = { paris: 'Paris', lyon: 'Lyon', marseille: 'Marseille', nice: 'Nice' };

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

/** Jour calendaire à Paris, pour compter « dans 3 jours » sans se tromper à minuit. */
const parisDay = (d: Date) =>
  Date.parse(d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }));

// ─────────────────────────────────────────────────────────────── briques ──

/** Point vivant : un halo qui s'étend et s'efface, en boucle. */
function LiveDot({ color = colors.primary }: { color?: string }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduce, v]);
  return (
    <View style={styles.dotWrap}>
      <Animated.View
        style={[styles.dotHalo, { backgroundColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }] }]}
      />
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

/** Jauge d'intensité sur 5 : les barres se remplissent une à une. */
function Meter({ level, delay = 0, hot = false, still = false }: { level: number; delay?: number; hot?: boolean; still?: boolean }) {
  const reduce = useReduceMotion() || still;
  const bars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(reduce ? 1 : 0))).current;
  const glow = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.stagger(70, bars.map(b =>
      Animated.timing(b, { toValue: 1, duration: 320, delay, useNativeDriver: true }))).start();
    if (!hot) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 0.4, duration: 800, delay: delay + 600, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, bars, glow, delay, hot]);
  return (
    <View style={styles.meter} accessibilityLabel={`Intensité ${level} sur 5`}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[styles.bar, i < level ? styles.barOn : styles.barOff, {
            opacity: hot && i === level - 1 ? glow : 1,
            transform: [{ translateX: b.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }, { scaleX: b }],
          }]}
        />
      ))}
    </View>
  );
}

/** Onglets avec curseur qui glisse (léger rebond). */
function Tabs({ value, onChange, labels }: { value: 0 | 1; onChange: (v: 0 | 1) => void; labels: [string, string] }) {
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: value, useNativeDriver: true, friction: 7, tension: 90 }).start();
  }, [value, x]);
  return (
    <View style={styles.tabs} onLayout={e => setW((e.nativeEvent.layout.width - 6) / 2)} accessibilityRole="tablist">
      {w > 0 && (
        <Animated.View
          style={[styles.thumb, { width: w, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, w] }) }] }]}
        />
      )}
      {labels.map((l, i) => (
        <TouchableOpacity
          key={l}
          style={styles.tab}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === i }}
          onPress={() => { if (value !== i) { hapticSelection(); onChange(i as 0 | 1); } }}
        >
          {i === 0 && <LiveDot />}
          <Text style={[styles.tabText, value === i && styles.tabTextOn]}>{l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Bannière de la perturbation la plus forte : son contour « respire ». */
function AlertBanner({ s }: { s: CitySignal }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1600, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 1600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, v]);
  return (
    <View style={styles.alert}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.alertGlow, { opacity: v }]} />
      <View style={styles.alertIcon}>
        <Feather name="alert-triangle" size={20} color={ALERT_TINT} />
      </View>
      <View style={styles.flex1}>
        <View style={styles.rowCenter}>
          <Text style={styles.alertTitle} numberOfLines={2}>{s.title}</Text>
        </View>
        {!!s.detail && <Text style={styles.alertText} numberOfLines={3}>{s.detail}</Text>}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────── icônes ──

type Glyph = { name: string; tint: string };

/** Une famille = une teinte ; dans la famille, l'icône dit exactement de quoi il s'agit. */
function glyphFor(s: CitySignal): Glyph {
  if (s.kind === 'train_arrivals') return { name: 'train-variant', tint: '#5CF2A6' };
  if (s.kind === 'transit_disruption') {
    const name = s.mode === 'tram' ? 'tram' : s.mode === 'metro' ? 'subway-variant' : 'train';
    return { name, tint: ALERT_TINT };
  }
  const title = s.title.toLowerCase();
  switch (s.mode) {
    case 'match':
      return { name: 'soccer', tint: '#7CC4FF' };
    case 'sport':
      if (title.includes('rugby')) return { name: 'rugby', tint: '#7CC4FF' };
      if (title.includes('euroleague') || title.includes('asvel') || title.includes('basket')) return { name: 'basketball', tint: '#7CC4FF' };
      if (title.includes('tennis') || title.includes('masters')) return { name: 'tennis', tint: '#7CC4FF' };
      return { name: 'soccer', tint: '#7CC4FF' };
    case 'concert':
      return { name: 'microphone-variant', tint: '#C9A7FF' };
    case 'festival':
      return { name: 'party-popper', tint: '#FFB547' };
    case 'spectacle':
      return { name: 'drama-masks', tint: '#FF9AD5' };
    case 'salon':
      return { name: 'storefront-outline', tint: '#9FE7D7' };
    default:
      return { name: 'star-four-points-outline', tint: colors.textMain };
  }
}

/** `#RRGGBB` + opacité → rgba. */
const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/**
 * Pastille d'icône : verre teinté en dégradé (plus lumineux en haut à gauche),
 * liseré de la même teinte. Le glyphe garde la teinte pleine : c'est lui qu'on lit.
 */
function IconTile({ glyph, size = 42, glow = false }: { glyph: Glyph; size?: number; glow?: boolean }) {
  return (
    <SafeGradient
      colors={[alpha(glyph.tint, glow ? 0.34 : 0.24), alpha(glyph.tint, 0.06)]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.iconTile, { width: size, height: size, borderRadius: size / 2, borderColor: alpha(glyph.tint, 0.38) }]}
    >
      <MaterialCommunityIcons name={glyph.name} size={Math.round(size * 0.5)} color={glyph.tint} />
    </SafeGradient>
  );
}

// ──────────────────────────────────────────────────────────────── lignes ──

function DisruptionRow({ s, index, top }: { s: CitySignal; index: number; top: boolean }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  const train = s.kind === 'train_arrivals';
  const when = train && s.starts_at
    ? (s.ends_at && s.ends_at !== s.starts_at ? `${hhmm(s.starts_at)}–${hhmm(s.ends_at)}` : hhmm(s.starts_at))
    : null;

  // Toute ligne se déplie : une perturbation montre le message complet de
  // l'opérateur et sa période, une gare toutes ses arrivées grandes lignes.
  const toggle = () => {
    hapticLight();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Animated.spring(turn, { toValue: open ? 0 : 1, useNativeDriver: true, friction: 8 }).start();
    setOpen(o => !o);
  };
  const go = () => {
    if (s.lat == null || s.lon == null) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`);
  };
  const day = (iso: string) =>
    `${new Date(iso).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })} ${hhmm(iso)}`;

  return (
    <AnimatedEntrance delay={260 + index * 60}>
      <TouchableOpacity activeOpacity={0.8} onPress={toggle} style={[styles.row, index > 0 && styles.rowSep]}
        accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <IconTile glyph={glyphFor(s)} glow={top} />
        <View style={styles.rowBody}>
          <View style={styles.rowLine}>
            <Text style={styles.rowPlace} numberOfLines={1}>{s.place ?? s.title}</Text>
            {when
              ? <Text style={styles.rowWhen}>{when}</Text>
              : <View style={styles.rowCenter}><LiveDot color={ALERT_TINT} /><Text style={[styles.rowWhen, styles.ongoing]}>{t('cityPulse.ongoing', 'En cours')}</Text></View>}
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowSub} numberOfLines={1}>{train ? trainSummary(s) : s.title}</Text>
            <Meter level={s.intensity} delay={500 + index * 60} hot={top} />
          </View>
        </View>
        <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
          <Feather name="chevron-down" size={18} color={colors.textDimmed} />
        </Animated.View>
      </TouchableOpacity>

      {open && train && (
        <View style={styles.expand}>
          <Text style={styles.expandHead}>{t('cityPulse.allArrivals', 'Arrivées grandes lignes · 3 prochaines heures')}</Text>
          {(s.items ?? []).map((it, i) => (
            <View key={i} style={[styles.trainLine, it.wave === false && styles.trainOff]}>
              <View style={[styles.waveMark, it.wave !== false && styles.waveMarkOn]} />
              <Text style={styles.trainAt}>{it.at}</Text>
              <View style={styles.flex1}>
                <Text style={styles.trainOrigin} numberOfLines={1}>{it.origin ?? '—'}</Text>
                <Text style={styles.trainMeta}>{it.mode}{it.number ? ` ${it.number}` : ''} · ≈ {it.seats} {t('cityPulse.seats', 'places')}</Text>
              </View>
              <Text style={[styles.trainStatus, it.delay > 0 && styles.trainLate]}>
                {it.delay > 0 ? `+${it.delay} min` : t('cityPulse.onTime', "à l'heure")}
              </Text>
            </View>
          ))}
          {s.lat != null && (
            <TouchableOpacity style={styles.goBtn} onPress={go} accessibilityRole="button">
              <Feather name="navigation" size={18} color={colors.onPrimary} />
              <Text style={styles.goText}>{t('cityPulse.goThere', 'Y aller')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {open && !train && (
        <View style={styles.expand}>
          {!!s.detail && <Text style={styles.expandText}>{s.detail}</Text>}
          {!!s.starts_at && (
            <View style={styles.periodLine}>
              <Feather name="calendar" size={14} color={colors.textMuted} />
              <Text style={styles.trainMeta}>
                {s.ends_at
                  ? t('cityPulse.period', 'Du {{from}} au {{to}}', { from: day(s.starts_at), to: day(s.ends_at) })
                  : t('cityPulse.since', 'Depuis {{from}}', { from: day(s.starts_at) })}
              </Text>
            </View>
          )}
          {!!s.place && (
            <View style={styles.periodLine}>
              <MaterialCommunityIcons name="map-marker-path" size={14} color={colors.textMuted} />
              <Text style={styles.trainMeta}>{s.place}</Text>
            </View>
          )}
        </View>
      )}
    </AnimatedEntrance>
  );
}

/** « 7 trains grandes lignes » + « ≈ 3 500 voyageurs entre… » → « 7 trains · ≈ 3 500 voyageurs ». */
function trainSummary(s: CitySignal) {
  const n = s.title.match(/^\d+/)?.[0];
  const pax = s.detail?.match(/≈\s*[\d\s\u202f]+voyageurs/)?.[0];
  return [n ? `${n} trains` : s.title, pax].filter(Boolean).join(' · ');
}

const EVENT_TAG: Record<string, string> = {
  match: 'MATCH', sport: 'SPORT', concert: 'CONCERT', festival: 'FESTIVAL', spectacle: 'SPECTACLE', salon: 'SALON',
};

type EventItem = CitySignal & { untilDay?: string };

/** Intensité minimale affichée dans « Événements » : environ 5 000 personnes
 *  attendues (affluence estimée côté serveur, salle × popularité Deezer). */
const BIG_CROWD = 3;

/**
 * Un salon ou un festival de 4 jours faisait 4 cartes identiques. On les
 * fusionne en une carte « jusqu'au … » quand les jours se suivent.
 */
function groupMultiDay(events: CitySignal[]): EventItem[] {
  const DAY = 86_400_000;
  const out: EventItem[] = [];
  // Dernière carte ouverte par salon/festival : les jours d'un même salon sont
  // entrecoupés d'autres événements dans la liste triée par date.
  const open = new Map<string, EventItem>();
  for (const e of events) {
    const multi = e.mode === 'salon' || e.mode === 'festival';
    const key = `${e.place}|${e.title}`;
    const g = multi ? open.get(key) : undefined;
    const last = g?.untilDay ?? g?.starts_at;
    if (g && e.starts_at && last && parisDay(new Date(e.starts_at)) - parisDay(new Date(last)) <= DAY) {
      g.untilDay = e.starts_at;
      g.intensity = Math.max(g.intensity, e.intensity);
      continue;
    }
    const item: EventItem = { ...e };
    out.push(item);
    if (multi) open.set(key, item);
  }
  return out;
}

const EventRow = React.memo(function EventRow({ s, index }: { s: EventItem; index: number }) {
  const { t, i18n } = useTranslation();
  const start = s.starts_at ? new Date(s.starts_at) : null;
  const days = start ? Math.round((parisDay(start) - parisDay(new Date())) / 86_400_000) : null;
  const dow = start?.toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'Europe/Paris' }).replace('.', '').toUpperCase();
  const day = start?.toLocaleDateString('fr-FR', { day: 'numeric', timeZone: 'Europe/Paris' });
  const until = s.untilDay
    ? t('cityPulse.until', "jusqu'au {{date}}", { date: new Date(s.untilDay).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }) })
    : null;
  const whenLabel = days == null ? '' : days <= 0 ? (until ?? t('cityPulse.today', "aujourd'hui"))
    : days === 1 ? t('cityPulse.tomorrow', 'demain') : t('cityPulse.inDays', 'dans {{n}} jours', { n: days });
  // Plage en cours ou à venir : « dans 15 jours · jusqu'au 25 oct. ».
  const whenFull = until && days != null && days > 0 ? `${whenLabel} · ${until}` : whenLabel;
  const time = s.ends_at && s.starts_at && !s.untilDay ? hhmm(s.starts_at) : null;
  // Sans heure publiée, on n'affiche rien plutôt qu'un « à confirmer ».
  // Affluence attendue plutôt que l'heure de fin : c'est elle qui dit si la
  // sortie vaut le déplacement. Lue dans le détail serveur (« ≈ 20 300 places »).
  const crowd = s.detail?.match(/≈\s*([\d\s  ]+)\s*(places|visiteurs|personnes)/)?.[1]?.trim();
  const crowdLabel = crowd ? t('cityPulse.people', '≈ {{n}} personnes', { n: crowd }) : null;
  // Seul le premier écran s'anime : 100+ cartes animées d'un coup figeaient l'onglet.
  const animated = index < FIRST_SCREEN;

  const card = (
      <View style={styles.eventCard}>
        <View>
          <View style={styles.dateTile}>
            <Text style={styles.dateDow}>{dow}</Text>
            <Text style={styles.dateDay}>{day}</Text>
          </View>
          {/* L'icône se pose sur le coin de la date : on lit « quand » puis « quoi ». */}
          <View style={styles.badge}>
            <IconTile glyph={glyphFor(s)} size={26} />
          </View>
        </View>
        <View style={styles.eventBody}>
          <View style={styles.rowCenter}>
            {!!s.mode && EVENT_TAG[s.mode] && <Text style={styles.tag}>{EVENT_TAG[s.mode]}</Text>}
            <Text style={styles.eventTitle} numberOfLines={1}>{s.title}</Text>
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>
            {s.place}{time ? ` · ${time}` : ''}
          </Text>
          <View style={styles.rowLine}>
            <Text style={styles.eventWhen} numberOfLines={1}>{whenFull}{crowdLabel ? ` · ${crowdLabel}` : ''}</Text>
            <Meter level={s.intensity} delay={420 + index * 60} still={!animated} />
          </View>
        </View>
      </View>
  );
  return animated ? <AnimatedEntrance delay={200 + index * 60}>{card}</AnimatedEntrance> : card;
});

const FIRST_SCREEN = 6;

// ──────────────────────────────────────────────────────────────── écran ──

const EventGap = () => <View style={styles.eventGap} />;

export default function CityPulseScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const [city, setCity] = useState<City | null>(null);
  const [tab, setTab] = useState<0 | 1>(0);
  const [rows, setRows] = useState<CitySignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => { loadCity().then(setCity); }, []);

  const latest = useRef<City | null>(null);
  const load = useCallback(async (c: City) => {
    latest.current = c;
    try {
      setFailed(false);
      const data = await fetchCitySignals(c);
      if (latest.current === c) setRows(data);
    } catch {
      if (latest.current === c) setFailed(true);
    } finally {
      if (latest.current === c) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => { if (city) { setLoading(true); load(city); } }, [city, load]);

  const pickCity = (c: City) => {
    if (c === city) return;
    hapticSelection();
    setCity(c);
    saveCity(c);
  };

  const { disruptions, events, banner, updatedAgo } = useMemo(() => {
    const now = Date.now();
    const current = rows.filter(r => isCurrent(r, now));
    const d = current.filter(isDisruption).sort((a, b) => b.intensity - a.intensity);
    const e = groupMultiDay(current.filter(r => r.kind === 'event')
      .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? '')));
    const strongest = d.find(r => r.kind === 'transit_disruption' && r.intensity >= 3) ?? null;
    const last = rows.reduce((m, r) => Math.max(m, Date.parse(r.updated_at)), 0);
    return {
      disruptions: d,
      events: e,
      banner: strongest,
      updatedAgo: last ? Math.max(0, Math.round((now - last) / 60_000)) : null,
    };
  }, [rows]);

  // Seuls les gros afflux : au-dessous, la sortie ne se voit pas dans la demande.
  const bigEvents = useMemo(() => events.filter(e => e.intensity >= BIG_CROWD), [events]);
  const list: EventItem[] = tab === 0 ? disruptions : bigEvents;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenField />
      <AnimatedEntrance step={0} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Retour')}>
          <Feather name="chevron-left" size={30} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={2}>{t('cityPulse.title', 'Afflux et événements')}</Text>
      </AnimatedEntrance>

      <AnimatedEntrance step={1}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cities}>
          {CITIES.map(c => (
            <TouchableOpacity key={c} onPress={() => pickCity(c)} style={[styles.cityChip, city === c && styles.cityChipOn]}
              accessibilityRole="button" accessibilityState={{ selected: city === c }}>
              <Text style={[styles.cityText, city === c && styles.cityTextOn]}>{CITY_LABEL[c]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </AnimatedEntrance>

      <AnimatedEntrance step={2} style={{ paddingHorizontal: space.xl }}>
        <Tabs value={tab} onChange={setTab}
          labels={[t('cityPulse.tabDisruptions', 'Afflux'), t('cityPulse.tabEvents', 'Événements')]} />
      </AnimatedEntrance>

      {loading ? (
        <BrandLoader style={{ marginTop: space.xxxl }} />
      ) : (
        <FlatList
          key={`${city}-${tab}`}
          data={tab === 1 ? list : []}
          keyExtractor={item => item.id}
          renderItem={({ item, index }) => <EventRow s={item} index={index} />}
          ItemSeparatorComponent={EventGap}
          initialNumToRender={FIRST_SCREEN + 2}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} colors={[colors.primary]}
            onRefresh={() => { if (city) { setRefreshing(true); load(city); } }} />}
          ListHeaderComponent={
            <View style={styles.headGap}>
              {failed && (
                <View style={styles.errorCard}>
                  <Feather name="alert-circle" size={18} color={colors.danger} />
                  <Text style={styles.errorText}>{t('errors.loadFailed', 'Erreur de chargement')}</Text>
                </View>
              )}

              {tab === 0 && banner && <AnimatedEntrance step={3}><AlertBanner s={banner} /></AnimatedEntrance>}

              <AnimatedEntrance step={3} style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>
                  {tab === 0 ? t('cityPulse.watch', 'À SURVEILLER') : t('cityPulse.upcoming', 'À VENIR')}
                </Text>
                <Text style={styles.sectionHint}>
                  {tab === 0 ? t('cityPulse.next3h', '3 prochaines heures') : t('cityPulse.next2m', '2 prochains mois')}
                </Text>
              </AnimatedEntrance>


              {list.length === 0 && !failed ? (
                <AnimatedEntrance step={4} style={styles.empty}>
                  <Feather name="clock" size={28} color={colors.textMuted} />
                  <Text style={styles.emptyTitle}>{t('cityPulse.calm', "Calme pour l'instant")}</Text>
                  <Text style={styles.emptyText}>
                    {tab === 0
                      ? t('cityPulse.calmDisruptions', 'Aucune perturbation ni vague de trains notable à {{city}}.', { city: city ? CITY_LABEL[city] : '' })
                      : t('cityPulse.calmEvents', 'Aucun grand événement prévu à {{city}} dans les 2 mois.', { city: city ? CITY_LABEL[city] : '' })}
                  </Text>
                </AnimatedEntrance>
              ) : tab === 0 ? (
                <View style={styles.card}>
                  {list.map((s, i) => <DisruptionRow key={s.id} s={s} index={i} top={i === 0} />)}
                </View>
              ) : null}
            </View>
          }
          ListFooterComponent={updatedAgo != null ? (
            <Text style={styles.footer}>
              {t('cityPulse.updated', 'Mis à jour il y a {{n}} min', { n: updatedAgo })}
            </Text>
          ) : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FIELD_TOP },
  flex1: { flex: 1 },
  ongoing: { color: ALERT_TINT, marginLeft: 6 },
  trainLate: { color: '#FFB547', fontWeight: '800' },
  eventBody: { flex: 1, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md },
  backBtn: { marginLeft: -10, width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, color: colors.textMain, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },

  cities: { paddingHorizontal: space.xl, gap: space.sm, paddingBottom: space.md },
  cityChip: {
    height: 38, paddingHorizontal: space.lg, borderRadius: radius.full, justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: strokeWidth.control, borderColor: stroke.edge,
  },
  cityChipOn: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: stroke.edgeLit },
  cityText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  cityTextOn: { color: colors.textMain, fontWeight: '800' },

  tabs: {
    flexDirection: 'row', padding: 3, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: strokeWidth.control, borderColor: stroke.edge,
  },
  thumb: {
    position: 'absolute', top: 3, bottom: 3, left: 3, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: strokeWidth.control, borderColor: stroke.edgeLit,
  },
  tab: { flex: 1, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tabText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  tabTextOn: { color: colors.textMain },

  scroll: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxxl },
  headGap: { gap: space.lg, marginBottom: space.sm },
  eventGap: { height: space.sm },

  dotWrap: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotHalo: { position: 'absolute', width: 7, height: 7, borderRadius: 4 },

  meter: { flexDirection: 'row', gap: 3, flexShrink: 0 },
  bar: { width: 12, height: 5, borderRadius: 3 },
  barOn: { backgroundColor: colors.primary },
  barOff: { backgroundColor: 'rgba(255,255,255,0.12)' },

  alert: {
    flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: 'rgba(255,181,71,0.08)', borderWidth: strokeWidth.control, borderColor: 'rgba(255,181,71,0.35)',
  },
  alertGlow: { borderRadius: radius.lg, borderWidth: 1.5, borderColor: 'rgba(255,181,71,0.7)' },
  alertIcon: {
    width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,181,71,0.16)',
  },
  alertTitle: { color: colors.textMain, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  alertText: { color: '#C9D1CD', fontSize: 14, lineHeight: 20, marginTop: 4 },

  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: space.xs },
  sectionTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 1.2 },
  sectionHint: { color: colors.textDimmed, fontSize: 13 },

  card: {
    borderRadius: radius.lg, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: strokeWidth.surface, borderColor: stroke.edge,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  rowSep: { borderTopWidth: strokeWidth.surface, borderTopColor: stroke.edge },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  rowBody: { flex: 1, gap: 4 },
  rowLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  rowPlace: { flex: 1, color: colors.textMain, fontSize: 16, fontWeight: '700' },
  rowWhen: { color: colors.textMain, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowSub: { flex: 1, color: colors.textMuted, fontSize: 13 },
  iconTile: { alignItems: 'center', justifyContent: 'center', borderWidth: strokeWidth.control, overflow: 'hidden' },
  badge: { position: 'absolute', right: -11, top: -11, borderRadius: radius.full, backgroundColor: FIELD_TOP, padding: 2 },

  expand: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm },
  expandHead: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 },
  expandText: { color: '#C9D1CD', fontSize: 14, lineHeight: 20 },
  periodLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  trainOff: { opacity: 0.55 },
  waveMark: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: 'transparent' },
  waveMarkOn: { backgroundColor: colors.primary },
  trainLine: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  trainAt: { width: 48, color: colors.textMain, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  trainOrigin: { color: colors.textMain, fontSize: 14, fontWeight: '600' },
  trainMeta: { color: colors.textMuted, fontSize: 12 },
  trainStatus: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  goBtn: {
    marginTop: space.sm, height: 48, borderRadius: radius.full, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  goText: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' },

  eventCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: strokeWidth.surface, borderColor: stroke.edge,
  },
  dateTile: {
    width: 48, height: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  dateDow: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  dateDay: { color: colors.textMain, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tag: {
    marginRight: space.sm, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: '#C9D1CD',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs, backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  eventTitle: { flex: 1, color: colors.textMain, fontSize: 16, fontWeight: '700' },
  eventWhen: { flex: 1, color: '#C9D1CD', fontSize: 12, fontWeight: '700' },

  empty: {
    alignItems: 'center', gap: space.sm, padding: space.xxl, borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: strokeWidth.surface, borderColor: stroke.edge,
  },
  emptyTitle: { color: colors.textMain, fontSize: 16, fontWeight: '700' },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md,
    borderWidth: strokeWidth.control, borderColor: stroke.alert,
  },
  errorText: { color: colors.textMain, fontSize: 14 },
  footer: { color: colors.textDimmed, fontSize: 12, lineHeight: 18, paddingHorizontal: space.xs, marginTop: space.lg },
});
