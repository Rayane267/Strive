/**
 * Onboarding de premier lancement — distinct du tutoriel.
 *
 * `TutorialScreen` reste accessible depuis le Profil et garde son rôle :
 * apprendre le geste et faire installer le raccourci AssistiveTouch. Cet écran-ci
 * a un autre métier : collecter les quatre faits qui permettent de calculer le
 * seuil de rentabilité du chauffeur, au lieu de le lui faire deviner sur un
 * curseur de 10 à 80 € — question à laquelle personne ne sait répondre.
 *
 * Une question par écran, réponses tapables, et un dernier écran qui montre le
 * chiffre que les réponses produisent : c'est lui qui justifie le formulaire.
 *
 * Le seuil est plafonné par le bas au point de rentabilité — voir
 * `utils/incomeGoal.deriveThreshold`, qui porte le raisonnement.
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Animated,
  Easing,
  Dimensions,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import * as Sentry from '@sentry/react-native';
import { useNavigation } from '@react-navigation/native';
import SafeGradient from '../components/SafeGradient';
import { colors } from '../theme/colors';
import { hapticLight, hapticSuccess } from '../utils/haptics';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import { deriveThreshold, SOCIAL_RATES, DriverStatus } from '../utils/incomeGoal';

const { width, height } = Dimensions.get('window');

/** Couleurs de marque des plateformes — identité, pas décoration. */
const PLATFORMS = [
  { key: 'UBER', label: 'Uber', dot: '#FFFFFF' },
  { key: 'BOLT', label: 'Bolt', dot: '#34BB78' },
  { key: 'HEETCH', label: 'Heetch', dot: '#FF3B80' },
] as const;

// Propositions rapides. `null` ouvre une saisie libre : taper une pastille bat
// le clavier, mais on ne ferme jamais la porte au chiffre exact.
//
// Les valeurs sont calées sur le métier, pas sur des ronds arbitraires. Un VTC
// à temps plein roule 45–60 h effectives, pas 35 ; et ses charges fixes ne sont
// quasiment jamais nulles — véhicule en LOA plus assurance VTC tournent autour
// de 700 €/mois, une location tout compris chez un loueur VTC autour de
// 1 400 €. Les anciens presets (35 h, 0 € de charges) donnaient un CA requis si
// bas que `deriveThreshold` retombait sur le plancher dans presque tous les cas :
// l'écran de résultat affichait alors un chiffre qui ne devait rien aux réponses.
//
// Cinq propositions plutôt que trois : à trois, l'écart entre deux réponses
// était tel que le chauffeur tapait « Autre » — donc le clavier — pour la
// plupart des situations réelles. Cinq + « Autre » tiennent en six cartes
// empilées sans que l'écran ait besoin de défiler.
const HOURS_CHOICES: (number | null)[] = [35, 40, 45, 50, 60, null];
const GOAL_CHOICES: (number | null)[] = [1500, 2000, 2500, 3000, 3500, null];
const COSTS_CHOICES: (number | null)[] = [0, 400, 700, 1000, 1400, null];
const STATUS_CHOICES: (number | null)[] = [
  SOCIAL_RATES.auto_entrepreneur,
  SOCIAL_RATES.societe,
  SOCIAL_RATES.salarie,
  null,
];

/**
 * Milliers séparés par une espace insécable. `toLocaleString` dépend d'un Intl
 * dont la présence varie selon la build Hermes ; sur un montant entier en euros
 * la règle tient en une ligne.
 */
const formatEuros = (n: number) =>
  `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;

/** Les 5 questions, puis l'écran de résultat. */
const STEPS = ['platforms', 'hours', 'goal', 'costs', 'status', 'result'] as const;
type Step = typeof STEPS[number];

const OnboardingScreen = ({ onFinish }: { onFinish?: () => void }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigation = useNavigation<any>();

  const [index, setIndex] = useState(0);
  const step: Step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  const [platforms, setPlatforms] = useState<string[]>(['UBER']);
  const [weeklyHours, setWeeklyHours] = useState(50);
  const [monthlyGoal, setMonthlyGoal] = useState(2500);
  // Défaut à 700 € plutôt que 0 : partir de « aucune charge » est le cas rare,
  // et c'est celui qui fausse le plus le seuil vers le bas.
  const [fixedCosts, setFixedCosts] = useState(700);
  const [socialRate, setSocialRate] = useState<number>(SOCIAL_RATES.auto_entrepreneur);

  /** Champ en saisie libre, ou null si tout est sur des pastilles. */
  const [editing, setEditing] = useState<Step | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const derived = deriveThreshold({ monthlyGoal, weeklyHours, fixedCosts, socialRate });

  /** Statut déduit du taux — « autre » dès que le taux est saisi à la main. */
  const driverStatus: DriverStatus =
    (Object.keys(SOCIAL_RATES) as (keyof typeof SOCIAL_RATES)[])
      .find(k => SOCIAL_RATES[k] === socialRate) ?? 'autre';

  // ── Transition entre questions ────────────────────────────────────────────
  // Un seul moment animé : le contenu sort et rentre avec un léger décalage
  // vertical. Sortie rapide, entrée en ease-out — c'est ce qui donne
  // l'impression que l'écran répond au doigt plutôt qu'il ne défile.
  const anim = useRef(new Animated.Value(1)).current;

  const go = (next: number) => {
    if (next < 0 || next >= STEPS.length) return;
    hapticLight();
    setEditing(null);
    Animated.timing(anim, {
      toValue: 0, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start(() => {
      setIndex(next);
      Animated.timing(anim, {
        toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    });
  };

  const finish = async () => {
    hapticSuccess();
    setSaving(true);
    // Best-effort : un échec d'enregistrement ne doit pas retenir le chauffeur à
    // l'entrée de l'app. Les valeurs sont reposables depuis les Préférences.
    try {
      if (user?.id) {
        await supabase.from('preferences').upsert({
          id: user.id,
          monthly_goal: monthlyGoal,
          weekly_hours: weeklyHours,
          fixed_costs: fixedCosts,
          driver_status: driverStatus,
          social_rate: socialRate,
          platforms,
          // Le seuil dérivé est enregistré même en gratuit (où FREE_THRESHOLDS
          // s'applique de toute façon) : le jour où le chauffeur passe Plus, son
          // seuil est déjà là et on ne lui repose pas les questions.
          ...(derived ? { min_hourly_rate: derived.hourly, min_km_rate: derived.km } : {}),
        });
      }
    } catch (e) {
      // On laisse passer l'utilisateur, mais pas l'échec : c'est le seul endroit
      // où ces réponses sont écrites. Un catch réellement muet ici signifierait
      // perdre l'onboarding de tout le parc sans jamais l'apprendre.
      Sentry.captureException(e, { tags: { flow: 'onboarding_save' } });
    } finally {
      setSaving(false);
      if (onFinish) onFinish();
      else if (navigation.canGoBack()) navigation.goBack();
    }
  };

  const onPrimary = () => (isLast ? finish() : go(index + 1));

  // ── Saisie libre ──────────────────────────────────────────────────────────

  const openDraft = (current: number, isPercent: boolean) => {
    hapticLight();
    setDraft(isPercent ? String(Math.round(current * 100)) : String(current));
    setEditing(step);
  };

  const commitDraft = (apply: (v: number) => void, isPercent: boolean) => {
    const raw = parseFloat(draft.replace(',', '.'));
    const value = isPercent ? raw / 100 : raw;
    if (Number.isFinite(value) && value >= 0) apply(value);
    setEditing(null);
  };

  // ── Rendus ────────────────────────────────────────────────────────────────

  /**
   * Liste de réponses en cartes pleine largeur, une par ligne. Une grille de
   * pastilles à 3 colonnes tenait sur moins de place, mais tassait les libellés
   * traduits et donnait des cibles tactiles étroites — or l'app se remplit
   * souvent d'une main, à l'arrêt entre deux courses. Une colonne unique lit
   * mieux et se tape sans viser.
   */
  const OptionList = ({
    choices, value, onPick, unit, zeroLabel, labelFor, subFor, isPercent,
  }: {
    choices: (number | null)[];
    value: number;
    onPick: (v: number) => void;
    unit?: string;
    zeroLabel?: string;
    labelFor?: (v: number) => string;
    /** Légende sous le chiffre — dit à quelle situation réelle il correspond. */
    subFor?: (v: number) => string;
    isPercent?: boolean;
  }) => {
    const onAnOption = choices.some(c => c !== null && c === value);
    return (
      <>
        <View style={styles.optionList}>
          {choices.map((c, i) => {
            const isOther = c === null;
            const active = isOther ? !onAnOption : c === value;
            return (
              <TouchableOpacity
                key={i}
                style={[styles.option, active && styles.optionActive]}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  if (isOther) { openDraft(value, !!isPercent); return; }
                  hapticLight();
                  setEditing(null);
                  onPick(c as number);
                }}
              >
                <Text style={[styles.optionTxt, active && styles.optionTxtActive]}>
                  {isOther
                    ? t('onboarding.other')
                    : labelFor
                      ? labelFor(c as number)
                      : c === 0 && zeroLabel
                        ? zeroLabel
                        : `${c}${unit ?? ''}`}
                </Text>
                {!isOther && subFor ? (
                  <Text
                    style={[styles.optionSub, active && styles.optionSubActive]}
                    numberOfLines={2}
                  >
                    {subFor(c as number)}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
        {editing === step ? (
          <View style={styles.draftRow}>
            <TextInput
              style={styles.draftInput}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => commitDraft(onPick, !!isPercent)}
              onEndEditing={() => commitDraft(onPick, !!isPercent)}
              keyboardType="numeric"
              returnKeyType="done"
              autoFocus
              selectTextOnFocus
              accessibilityLabel={t('onboarding.other')}
            />
            <Text style={styles.draftUnit}>{isPercent ? '%' : unit ?? ''}</Text>
          </View>
        ) : null}
      </>
    );
  };

  const renderStep = () => {
    switch (step) {
      case 'platforms':
        return (
          <View style={styles.platformList}>
            {PLATFORMS.map(p => {
              const active = platforms.includes(p.key);
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.platformRow, active && styles.platformRowActive]}
                  activeOpacity={0.85}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  onPress={() => {
                    hapticLight();
                    // Au moins une plateforme : décocher la dernière n'a pas de sens,
                    // le scanner doit savoir quoi reconnaître.
                    setPlatforms(prev =>
                      prev.includes(p.key)
                        ? (prev.length > 1 ? prev.filter(k => k !== p.key) : prev)
                        : [...prev, p.key],
                    );
                  }}
                >
                  <View style={[styles.platformDot, { backgroundColor: p.dot }]} />
                  <Text style={[styles.platformLabel, active && styles.platformLabelActive]}>
                    {p.label}
                  </Text>
                  <Feather
                    name={active ? 'check-circle' : 'circle'}
                    size={20}
                    color={active ? colors.primary : 'rgba(255,255,255,0.18)'}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        );

      case 'hours':
        return <OptionList choices={HOURS_CHOICES} value={weeklyHours} onPick={setWeeklyHours} unit=" h" />;

      case 'goal':
        return (
          <OptionList
            choices={GOAL_CHOICES}
            value={monthlyGoal}
            onPick={setMonthlyGoal}
            labelFor={v => formatEuros(v)}
          />
        );

      case 'costs':
        return (
          <OptionList
            choices={COSTS_CHOICES}
            value={fixedCosts}
            onPick={setFixedCosts}
            zeroLabel={t('onboarding.costs.none')}
            labelFor={v => (v === 0 ? t('onboarding.costs.none') : formatEuros(v))}
            subFor={v =>
              v === 0 ? t('onboarding.costs.subOwned')
              : v === 400 ? t('onboarding.costs.subCredit')
              : v === 700 ? t('onboarding.costs.subLease')
              : v === 1000 ? t('onboarding.costs.subWeekly')
              : t('onboarding.costs.subRental')}
          />
        );

      case 'status':
        return (
          <OptionList
            choices={STATUS_CHOICES}
            value={socialRate}
            onPick={setSocialRate}
            isPercent
            labelFor={v =>
              v === SOCIAL_RATES.auto_entrepreneur ? t('onboarding.status.auto')
              : v === SOCIAL_RATES.societe ? t('onboarding.status.company')
              : t('onboarding.status.employee')}
          />
        );

      case 'result':
        return derived ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>{t('onboarding.result.label')}</Text>
            <Text style={styles.resultValue} numberOfLines={1} adjustsFontSizeToFit>
              {derived.hourly.toFixed(0)} €/h
            </Text>
            <Text style={styles.resultKm}>{t('onboarding.result.orKm', { km: derived.km.toFixed(2) })}</Text>

            <View style={styles.resultDivider} />

            {/* Les trois chiffres qui rendent le seuil vérifiable : sans eux, la
                carte affiche un nombre sorti de nulle part — et dans le cas
                plancher, un nombre identique quelles que soient les réponses. */}
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatEuros(derived.requiredRevenue)}</Text>
                <Text style={styles.statLabel}>{t('onboarding.result.statRevenue')}</Text>
              </View>
              <View style={styles.statSep} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{derived.monthlyHours} h</Text>
                <Text style={styles.statLabel}>{t('onboarding.result.statHours')}</Text>
              </View>
              <View style={styles.statSep} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatEuros(monthlyGoal)}</Text>
                <Text style={styles.statLabel}>{t('onboarding.result.statNet')}</Text>
              </View>
            </View>

            <View style={styles.resultDivider} />

            <Text style={styles.resultNote}>
              {derived.flooredByProfitability
                ? t('onboarding.result.floored')
                : t('onboarding.result.fromGoal')}
            </Text>
          </View>
        ) : null;
    }
  };

  const title = t(`onboarding.${step}.title`);
  const desc = t(`onboarding.${step}.desc`);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.glow} pointerEvents="none" />

      {/* Chrome identique au tutoriel : progression à gauche, sortie à droite. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => go(index - 1)}
          disabled={index === 0}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Retour')}
        >
          <Feather
            name="arrow-left"
            size={22}
            color={index === 0 ? 'transparent' : colors.textMuted}
          />
        </TouchableOpacity>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((index + 1) / STEPS.length) * 100}%` }]} />
        </View>

        <TouchableOpacity
          onPress={finish}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.skip')}
        >
          <Text style={styles.skipTxt}>{t('onboarding.skip')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          style={{
            width: '100%',
            alignItems: 'center',
            opacity: anim,
            transform: [{
              translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
            }],
          }}
        >
          <Text style={styles.title}>{title}</Text>
          {desc ? <Text style={styles.desc}>{desc}</Text> : null}
          <View style={styles.stepContent}>{renderStep()}</View>
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.counter}>
          {t('onboarding.counter', { current: index + 1, total: STEPS.length })}
        </Text>
        <TouchableOpacity
          style={styles.cta}
          onPress={onPrimary}
          activeOpacity={0.88}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={isLast ? t('onboarding.start') : t('onboarding.next')}
        >
          <SafeGradient
            colors={isLast ? [colors.primary, '#00C864'] : [colors.surface, colors.surfaceLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.ctaInner}
          >
            <Text style={[styles.ctaTxt, isLast && styles.ctaTxtLast]}>
              {isLast ? t('onboarding.start') : t('onboarding.next')}
            </Text>
            <Feather
              name="arrow-right"
              size={19}
              color={isLast ? colors.background : colors.textMain}
            />
          </SafeGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Halo discret, même vocabulaire que le tutoriel.
  glow: {
    position: 'absolute',
    width: width * 0.9,
    height: width * 0.9,
    borderRadius: width * 0.45,
    top: -height * 0.06,
    alignSelf: 'center',
    backgroundColor: colors.primary + '09',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 16,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 2 },
  skipTxt: { color: colors.textMuted, fontSize: 14, fontWeight: '600', letterSpacing: 0.3 },

  body: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 24,
  },

  // Plus d'air au-dessus du titre qu'en dessous : le regard entre par lui.
  title: {
    color: colors.textMain,
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.8,
    lineHeight: 40,
    marginBottom: 12,
  },
  desc: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 23,
    maxWidth: 320,
  },
  stepContent: { width: '100%', marginTop: 34 },

  // ── Cartes de réponse ──────────────────────────────────────────────────────
  optionList: { gap: 10 },
  option: {
    minHeight: 64,
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  // Sélection en aplat plein plutôt qu'en teinte légère : sur fond sombre, un
  // fond à 11 % d'opacité se distingue mal de l'état par défaut, surtout en
  // plein soleil dans une voiture.
  optionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionTxt: { color: colors.textMain, fontSize: 17, fontWeight: '700' },
  optionTxtActive: { color: colors.background },
  optionSub: {
    color: colors.textDimmed,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 3,
  },
  optionSubActive: { color: colors.background + 'B0' },

  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.primary + '70',
  },
  draftInput: {
    flex: 1,
    paddingVertical: 13,
    color: colors.textMain,
    fontSize: 18,
    fontWeight: '800',
  },
  draftUnit: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },

  // ── Plateformes ────────────────────────────────────────────────────────────
  // Même gabarit que les cartes de réponse pour que les six étapes se suivent
  // sans rupture. L'état actif reste en teinte légère et non en aplat plein :
  // le choix est multiple ici, et trois lignes vertes d'affilée écraseraient
  // tout le reste de l'écran.
  platformList: { gap: 10 },
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 64,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  platformRowActive: { backgroundColor: colors.primary + '14', borderColor: colors.primary + '5A' },
  platformDot: { width: 10, height: 10, borderRadius: 5 },
  platformLabel: { flex: 1, color: colors.textMuted, fontSize: 17, fontWeight: '700' },
  platformLabelActive: { color: colors.textMain },

  // ── Carte de résultat ──────────────────────────────────────────────────────
  resultCard: {
    alignItems: 'center',
    paddingVertical: 26,
    paddingHorizontal: 22,
    borderRadius: 22,
    backgroundColor: colors.primary + '12',
    borderWidth: 1,
    borderColor: colors.primary + '3A',
  },
  resultLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  resultValue: {
    color: colors.primary,
    fontSize: 46,
    fontWeight: '900',
    letterSpacing: -1.5,
    marginTop: 8,
  },
  resultKm: { color: colors.textMain, fontSize: 15, fontWeight: '700', marginTop: 2 },
  resultDivider: {
    width: 44,
    height: 1,
    backgroundColor: colors.primary + '38',
    marginVertical: 16,
  },

  // Trois colonnes de largeur égale : c'est l'alignement qui les fait lire
  // comme un même calcul plutôt que comme trois faits séparés.
  statRow: { flexDirection: 'row', alignItems: 'stretch', alignSelf: 'stretch' },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statSep: { width: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 2 },
  statValue: {
    color: colors.textMain,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  statLabel: {
    color: colors.textDimmed,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 4,
  },
  resultNote: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },

  footer: { paddingHorizontal: 24, paddingBottom: 18, gap: 14, alignItems: 'center' },
  counter: { color: colors.textDimmed, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  cta: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 58,
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  ctaTxt: { color: colors.textMain, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  ctaTxtLast: { color: colors.background },
});

export default OnboardingScreen;
