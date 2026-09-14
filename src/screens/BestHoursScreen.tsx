import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AnimatedEntrance from '../components/AnimatedEntrance';
import { hapticLight, hapticSelection } from '../utils/haptics';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getEffectivePlanTier } from '../services/subscriptionService';
import { fetchRidesInRange } from '../services/ridesService';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { FIELD_TOP } from '../theme/field';
import ScreenField from '../components/ScreenField';
import {
  buildHourGrid,
  cellIndex,
  intensity,
  metricValue,
  topSlots,
  DAYS_IN_WEEK,
  HOURS_IN_DAY,
  MIN_SAMPLE,
  type HourCell,
  type HourGrid,
  type SlotMetric,
} from '../utils/bestHours';

/**
 * Fenêtre d'analyse, en jours.
 *
 * 90 et non « tout l'historique » : au-delà, les habitudes de la ville et
 * celles du chauffeur ont changé, et une moyenne sur deux ans lisserait
 * justement ce qu'on cherche à voir. C'est aussi la borne qui garde la lecture
 * à une seule requête paginée.
 */
const WINDOW_DAYS = 90;

/** Nombre de courses en dessous duquel la grille ne veut encore rien dire. */
const MIN_TOTAL = 40;

/** Heures étiquetées sous la grille — les 24 ne tiennent pas en largeur. */
const LABELLED_HOURS = [0, 6, 12, 18];

const BestHoursScreen = () => {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const { profile } = useAuth();

  const isPremium = getEffectivePlanTier(profile) === 'premium';

  const [loading, setLoading] = useState(true);
  const [grid, setGrid] = useState<HourGrid | null>(null);
  const [metric, setMetric] = useState<SlotMetric>('offers');
  const [selected, setSelected] = useState<HourCell | null>(null);

  /// Position et largeur mesurées des deux segments du sélecteur.
  ///
  /// « Ça sonne » et « Ça paie » n'ont pas la même largeur : un curseur de
  /// taille fixe déborderait de l'un ou flotterait dans l'autre, et les
  /// traductions changeront ces longueurs.
  const [segLayout, setSegLayout] = useState<
    Record<SlotMetric, { x: number; width: number }>
  >({ offers: { x: 0, width: 0 }, hourlyRate: { x: 0, width: 0 } });
  const segMeasured = segLayout.offers.width > 0 && segLayout.hourlyRate.width > 0;

  /// 0 = « Ça sonne », 1 = « Ça paie ». Le curseur GLISSE : c'est ce qui fait
  /// comprendre qu'on bascule entre deux lectures d'une même grille, là où deux
  /// fonds qui s'allument et s'éteignent donnent deux boutons sans rapport.
  const segAnim = useRef(new Animated.Value(0)).current;

  /// Fondu de la grille au changement de métrique.
  ///
  /// Les 168 cases changent de couleur d'un coup, ce qui saute à l'œil. Les
  /// animer une par une demanderait 168 valeurs pilotées en JS — impensable.
  /// Un fondu bref sur le CONTENEUR coûte une seule valeur et suffit : le
  /// regard lit une transition, pas un clignotement.
  const gridFade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(segAnim, {
      toValue: metric === 'hourlyRate' ? 1 : 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      // `width` n'est pas animable par le driver natif, et mélanger les deux
      // pilotes sur la même vue produit des sauts d'une frame.
      useNativeDriver: false,
    }).start();

    Animated.sequence([
      Animated.timing(gridFade, {
        toValue: 0.35,
        duration: 110,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(gridFade, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [metric, segAnim, gridFade]);

  const load = useCallback(async () => {
    if (!profile?.id || !isPremium) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
      const rides = await fetchRidesInRange(profile.id, start, end);
      setGrid(buildHourGrid(rides));
    } catch {
      setGrid(null);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, isPremium]);

  useEffect(() => {
    load();
  }, [load]);

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';

  // 1er janvier 2024 est un lundi : la semaine de référence se déroule donc
  // dans le même ordre que la grille, sans table de correspondance à maintenir.
  const dayNames = useMemo(() => {
    const monday = new Date(2024, 0, 1);
    return Array.from({ length: DAYS_IN_WEEK }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const name = d.toLocaleDateString(locale, { weekday: 'short' });
      return name.charAt(0).toUpperCase() + name.slice(1).replace('.', '');
    });
  }, [locale]);

  const max = grid
    ? metric === 'offers'
      ? grid.maxOffers
      : grid.maxHourlyRate
    : 0;

  const best = useMemo(
    () => (grid ? topSlots(grid, metric, 3) : []),
    [grid, metric],
  );

  const money = (v: number) =>
    `${v.toFixed(2).replace('.', i18n.language === 'fr' ? ',' : '.')} €`;

  const slotLabel = (cell: HourCell) =>
    t('bestHours.slot', {
      day: dayNames[cell.day],
      hour: cell.hour,
      nextHour: (cell.hour + 1) % HOURS_IN_DAY,
    });

  const cellColor = (cell: HourCell) => {
    const a = intensity(metricValue(cell, metric), max);
    if (a === 0) return 'rgba(255,255,255,0.04)';
    // 0,12 de plancher : une case à une seule course doit rester visible,
    // sinon la grille montre des trous là où il s'est passé quelque chose.
    return `rgba(0,230,118,${(0.12 + a * 0.78).toFixed(3)})`;
  };

  const renderGate = () => (
    <View style={styles.lockCard}>
      <View style={styles.lockIcon}>
        <Feather name="clock" size={22} color={colors.primary} />
      </View>
      <Text style={styles.lockTitle}>{t('bestHours.lockTitle')}</Text>
      <Text style={styles.lockSub}>{t('bestHours.lockSub')}</Text>
      <TouchableOpacity
        style={styles.cta}
        onPress={() => navigation.navigate('SubscriptionScreen')}
        activeOpacity={0.85}
      >
        <Text style={styles.ctaText}>{t('bestHours.lockCta')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderGrid = (g: HourGrid) => (
    <>
      <View style={styles.metricRow}>
        {segMeasured && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.metricThumb,
              {
                transform: [
                  {
                    translateX: segAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [segLayout.offers.x, segLayout.hourlyRate.x],
                    }),
                  },
                ],
                width: segAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [segLayout.offers.width, segLayout.hourlyRate.width],
                }),
              },
            ]}
          />
        )}

        {(['offers', 'hourlyRate'] as SlotMetric[]).map(m => {
          const on = metric === m;
          return (
            <TouchableOpacity
              key={m}
              style={styles.metricBtn}
              onLayout={e => {
                const { x, width } = e.nativeEvent.layout;
                setSegLayout(prev =>
                  prev[m].x === x && prev[m].width === width
                    ? prev
                    : { ...prev, [m]: { x, width } },
                );
              }}
              onPress={() => {
                if (metric === m) return;
                hapticLight();
                setMetric(m);
                setSelected(null);
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.metricTxt, on && styles.metricTxtOn]}>
                {t(`bestHours.metric.${m}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.metricHint}>{t(`bestHours.hint.${metric}`)}</Text>

      <Animated.View style={[styles.grid, { opacity: gridFade }]}>
        {dayNames.map((name, day) => (
          // Une vague du lundi au dimanche plutôt qu'une apparition en bloc.
          // L'entrée est portée par la LIGNE et non par la case : sept vues
          // animées au lieu de cent soixante-huit, pour un effet identique à
          // l'œil — on lit la vague, pas les cases individuelles.
          <AnimatedEntrance key={name} delay={day * 45} slideFrom="left" slideDistance={14}>
          <View style={styles.gridRow}>
            <Text style={styles.dayLabel}>{name}</Text>
            {Array.from({ length: HOURS_IN_DAY }, (_, hour) => {
              const cell = g.cells[cellIndex(day, hour)];
              const isOn =
                selected?.day === day && selected?.hour === hour;
              return (
                <TouchableOpacity
                  key={hour}
                  style={[
                    styles.cell,
                    { backgroundColor: cellColor(cell) },
                    isOn && styles.cellOn,
                  ]}
                  onPress={() => {
                    hapticSelection();
                    setSelected(isOn ? null : cell);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={slotLabel(cell)}
                />
              );
            })}
          </View>
          </AnimatedEntrance>
        ))}

        <View style={styles.hourAxis}>
          <View style={styles.dayLabelSpacer} />
          {Array.from({ length: HOURS_IN_DAY }, (_, hour) => (
            <Text key={hour} style={styles.hourLabel}>
              {LABELLED_HOURS.includes(hour) ? hour : ''}
            </Text>
          ))}
        </View>
      </Animated.View>

      {/* Détail de la case touchée. Une grille en dégradé donne une forme, pas
          un chiffre : sans cette ligne, on lit « c'est plus vert ici » sans
          jamais savoir de combien. */}
      {selected ? (
        // `key` sur le créneau : sans elle React réutilise la même vue d'une
        // case à l'autre et l'animation d'entrée ne rejoue jamais. Avec elle,
        // chaque nouveau créneau remonte le détail.
        <AnimatedEntrance key={`${selected.day}-${selected.hour}`} slideDistance={10} duration={240}>
        <View style={styles.detail}>
          <Text style={styles.detailTitle}>{slotLabel(selected)}</Text>
          <Text style={styles.detailBody}>
            {t('bestHours.detailOffers', { count: selected.offers })}
            {selected.hourlyRate !== null
              ? ` · ${money(selected.hourlyRate)}${t('bestHours.perHour')}`
              : ` · ${t('bestHours.noAccepted')}`}
          </Text>
        </View>
        </AnimatedEntrance>
      ) : (
        <Text style={styles.detailPlaceholder}>{t('bestHours.tapHint')}</Text>
      )}

      <Text style={styles.sectionTitle}>{t(`bestHours.top.${metric}`)}</Text>
      {best.length === 0 ? (
        <Text style={styles.detailPlaceholder}>
          {t('bestHours.notEnoughSlots', { min: MIN_SAMPLE })}
        </Text>
      ) : (
        <View style={styles.card}>
          {best.map((cell, i) => (
            <AnimatedEntrance
              key={`${metric}-${cell.day}-${cell.hour}`}
              delay={i * 70}
              slideDistance={12}
            >
              {i > 0 ? <View style={styles.sep} /> : null}
              <View style={styles.line}>
                <Text style={styles.rank}>{i + 1}</Text>
                <Text style={styles.slotName}>{slotLabel(cell)}</Text>
                <Text style={styles.slotValue}>
                  {metric === 'offers'
                    ? t('bestHours.detailOffers', { count: cell.offers })
                    : `${money(cell.hourlyRate ?? 0)}${t('bestHours.perHour')}`}
                </Text>
              </View>
            </AnimatedEntrance>
          ))}
        </View>
      )}

      <Text style={styles.footnote}>
        {t('bestHours.footnote', { days: WINDOW_DAYS, rides: g.totalOffers })}
      </Text>
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Pose en premier, donc derriere tout le reste. Il remplit la zone SOUS
          l'encoche, et `container` porte la meme couleur que son sommet : la
          bande de statut se confond avec lui au lieu de faire un bandeau. */}
      <ScreenField />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Feather name="chevron-left" size={30} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('bestHours.title')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!isPremium ? (
          renderGate()
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !grid || grid.totalOffers < MIN_TOTAL ? (
          // Refuser d'afficher plutôt que d'afficher du bruit : une grille
          // presque vide se lit quand même comme une recommandation, et enverrait
          // le chauffeur travailler une heure creuse sur la foi de deux courses.
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>{t('bestHours.empty')}</Text>
            <Text style={styles.emptyHint}>
              {t('bestHours.emptyHint', {
                min: MIN_TOTAL,
                current: grid?.totalOffers ?? 0,
              })}
            </Text>
          </View>
        ) : (
          renderGrid(grid)
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FIELD_TOP },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  backBtn: {
    marginLeft: -10,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    marginRight: space.md,
    color: colors.textMain,
    fontSize: 26,
    fontWeight: '800',
  },
  headerSpacer: { width: 38 },

  content: { paddingHorizontal: space.xl, paddingBottom: space.xxl },
  center: { paddingVertical: space.xxxl, alignItems: 'center' },
  emptyTitle: { color: colors.textMain, fontSize: 16, fontWeight: '700' },
  emptyHint: {
    color: colors.textDimmed,
    fontSize: 13,
    lineHeight: 19,
    marginTop: space.sm,
    textAlign: 'center',
  },

  // Un rail et un curseur qui glisse — le même geste que le sélecteur de palier
  // du paywall, pour qu'on reconnaisse le même objet d'un écran à l'autre.
  metricRow: {
    flexDirection: 'row',
    padding: space.xs,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    marginBottom: space.sm,
  },
  metricThumb: {
    position: 'absolute',
    left: 0,
    top: 4,
    bottom: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,230,118,0.20)',
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
  },
  metricBtn: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricTxt: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  metricTxtOn: { color: colors.textMain },
  metricHint: {
    color: colors.textDimmed,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: space.md,
  },

  grid: { marginBottom: space.md },
  gridRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.tight },
  dayLabel: {
    width: 30,
    color: colors.textDimmed,
    fontSize: 10,
    fontWeight: '700',
  },
  dayLabelSpacer: { width: 30 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    marginRight: space.tight,
    borderRadius: radius.xs,
  },
  cellOn: {
    borderWidth: strokeWidth.control,
    borderColor: colors.textMain,
  },
  hourAxis: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
  hourLabel: {
    flex: 1,
    marginRight: space.tight,
    color: colors.textDimmed,
    fontSize: 8,
    textAlign: 'left',
  },

  detail: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: space.md,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    marginBottom: space.lg,
  },
  detailTitle: { color: colors.textMain, fontSize: 14, fontWeight: '800' },
  detailBody: { color: colors.textMuted, fontSize: 13, marginTop: space.tight },
  detailPlaceholder: {
    color: colors.textDimmed,
    fontSize: 12,
    marginBottom: space.lg,
  },

  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: space.sm,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
  },
  sep: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: space.sm,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rank: {
    width: 18,
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  slotName: { flex: 1, color: colors.textMain, fontSize: 14, fontWeight: '700' },
  slotValue: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },

  footnote: {
    color: colors.textDimmed,
    fontSize: 11,
    lineHeight: 16,
    marginTop: space.md,
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignSelf: 'stretch',
  },
  ctaText: { color: colors.background, fontSize: 16, fontWeight: '800' },

  lockCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.xl,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    alignItems: 'center',
  },
  lockIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,230,118,0.10)',
    marginBottom: space.md,
  },
  lockTitle: {
    color: colors.textMain,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  lockSub: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: space.sm,
    marginBottom: space.lg,
  },
});

export default BestHoursScreen;
