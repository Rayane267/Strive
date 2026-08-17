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

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Animated,
  Easing,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import * as Sentry from '@sentry/react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { hapticLight, hapticSuccess } from '../utils/haptics';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import { deriveThreshold, SOCIAL_RATES, DriverStatus } from '../utils/incomeGoal';
import { getEffectivePlanTier, FREE_THRESHOLDS } from '../services/subscriptionService';

// « OTHER » est un choix comme un autre : il n'ouvre aucune saisie. Le scanner
// n'a pas besoin de connaître le nom de la plateforme pour lire un montant, et
// demander lequel ferait payer un clavier pour une information inexploitée.
const PLATFORMS = [
  { key: 'UBER', label: 'Uber' },
  { key: 'BOLT', label: 'Bolt' },
  { key: 'HEETCH', label: 'Heetch' },
  { key: 'OTHER', label: null },
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
  const { user, profile } = useAuth();
  const navigation = useNavigation<any>();
  const isPremium = getEffectivePlanTier(profile) !== 'free';

  const [index, setIndex] = useState(0);
  const step: Step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  // Aucune réponse pré-cochée : une valeur par défaut est une réponse que le
  // chauffeur n'a pas donnée, et elle produit pourtant un seuil de rentabilité
  // qu'il croira être le sien. `null` = pas encore répondu, et le bouton
  // « Continuer » reste inactif tant que c'est le cas.
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [weeklyHours, setWeeklyHours] = useState<number | null>(null);
  const [monthlyGoal, setMonthlyGoal] = useState<number | null>(null);
  const [fixedCosts, setFixedCosts] = useState<number | null>(null);
  const [socialRate, setSocialRate] = useState<number | null>(null);

  /** Champ en saisie libre, ou null si tout est sur des pastilles. */
  const [editing, setEditing] = useState<Step | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const derived =
    monthlyGoal !== null && weeklyHours !== null && fixedCosts !== null && socialRate !== null
      ? deriveThreshold({ monthlyGoal, weeklyHours, fixedCosts, socialRate })
      : null;

  /** Une étape n'est franchissable qu'une fois sa question répondue. */
  const answered: Record<Step, boolean> = {
    platforms: platforms.length > 0,
    hours: weeklyHours !== null,
    goal: monthlyGoal !== null,
    costs: fixedCosts !== null,
    status: socialRate !== null,
    result: true,
  };
  const canContinue = answered[step];

  /** Statut déduit du taux — « autre » dès que le taux est saisi à la main. */
  const driverStatus: DriverStatus =
    (Object.keys(SOCIAL_RATES) as (keyof typeof SOCIAL_RATES)[])
      .find(k => socialRate !== null && SOCIAL_RATES[k] === socialRate) ?? 'autre';

  // ── Transition entre questions ────────────────────────────────────────────
  // Un seul moment animé : le contenu sort et rentre avec un léger décalage
  // vertical. Sortie rapide, entrée en ease-out — c'est ce qui donne
  // l'impression que l'écran répond au doigt plutôt qu'il ne défile.
  const anim = useRef(new Animated.Value(1)).current;

  // ── Révélation du résultat ────────────────────────────────────────────────
  // Le dernier écran est le seul qui affiche un chiffre produit par les
  // réponses : il s'écrit en montant depuis zéro plutôt que d'apparaître fait.
  // C'est le seul endroit de l'onboarding qui mérite qu'on s'y arrête.
  const reveal = useRef(new Animated.Value(0)).current;
  const [counted, setCounted] = useState(0);

  useEffect(() => {
    if (step !== 'result') return;
    reveal.setValue(0);
    const id = reveal.addListener(({ value }) => {
      setCounted(Math.round(value * FREE_THRESHOLDS.hourly));
    });
    Animated.timing(reveal, {
      toValue: 1,
      duration: 900,
      delay: 260,
      easing: Easing.out(Easing.cubic),
      // Le compteur lit la valeur depuis JS : le pilote natif la rendrait
      // inaccessible et le chiffre resterait figé à zéro.
      useNativeDriver: false,
    }).start();
    return () => reveal.removeListener(id);
  }, [step, reveal]);

  const go = (next: number) => {
    if (next < 0 || next >= STEPS.length) return;
    hapticLight();
    setEditing(null);
    // La question répondue s'efface en reculant — fondu plus léger recul en
    // échelle, ce qui la fait lire comme « emportée » plutôt que simplement
    // masquée — puis la suivante revient de l'avant. Sortie brève et entrée
    // deux fois plus longue : c'est le déséquilibre qui donne la sensation de
    // réponse au doigt.
    Animated.timing(anim, {
      toValue: 0, duration: 160, easing: Easing.in(Easing.quad), useNativeDriver: true,
    }).start(() => {
      setIndex(next);
      Animated.timing(anim, {
        toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true,
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

  const openDraft = (current: number | null, isPercent: boolean) => {
    hapticLight();
    // Champ vide quand rien n'a encore été répondu : pré-remplir reviendrait à
    // proposer une réponse, ce que « Autre » est justement censé éviter.
    setDraft(
      current === null ? '' : isPercent ? String(Math.round(current * 100)) : String(current),
    );
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
    value: number | null;
    onPick: (v: number | null) => void;
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
            // « Autre » ne s'allume qu'une fois une valeur saisie : tant que rien
            // n'est répondu, `value` vaut null et aucune carte ne doit paraître
            // choisie.
            const active = isOther ? value !== null && !onAnOption : c === value;
            return (
              <TouchableOpacity
                key={i}
                style={[styles.option, active && styles.optionActive]}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  hapticLight();
                  // Retaper la carte déjà choisie annule la réponse et regrise
                  // « Continuer » : on ne peut pas se retrouver coincé avec une
                  // réponse tapée par erreur.
                  if (active) {
                    setEditing(null);
                    onPick(null);
                    return;
                  }
                  if (isOther) { openDraft(value, !!isPercent); return; }
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
          <View style={styles.optionList}>
            {PLATFORMS.map(p => {
              const active = platforms.includes(p.key);
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.option, active && styles.optionActive]}
                  activeOpacity={0.85}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  onPress={() => {
                    hapticLight();
                    // Toute plateforme peut être décochée, y compris la dernière :
                    // « Continuer » se grise alors, ce qui dit mieux qu'un clic
                    // sans effet qu'il faut au moins un choix.
                    setPlatforms(prev =>
                      prev.includes(p.key)
                        ? prev.filter(k => k !== p.key)
                        : [...prev, p.key],
                    );
                  }}
                >
                  <Text style={[styles.optionTxt, active && styles.optionTxtActive]}>
                    {p.label ?? t('onboarding.other')}
                  </Text>
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
            {/* Le chiffre reste masqué en gratuit : c'est la contrepartie de
                l'abonnement, et il ne servirait à rien de le donner ici puisque
                le palier gratuit applique de toute façon FREE_THRESHOLDS. Les
                trois statistiques dessous, elles, viennent des réponses du
                chauffeur et rendent le calcul crédible sans le livrer. */}
            {isPremium ? (
              <>
                <Text style={styles.resultLabel}>{t('onboarding.result.label')}</Text>
                <Text style={styles.resultValue} numberOfLines={1} adjustsFontSizeToFit>
                  {derived.hourly.toFixed(0)} €/h
                </Text>
                <Text style={styles.resultKm}>
                  {t('onboarding.result.orKm', { km: derived.km.toFixed(2) })}
                </Text>
              </>
            ) : (
              <>
                {/* Les deux seuils l'un au-dessus de l'autre : c'est l'écart qui
                    argumente, pas une phrase de vente. Le chiffre du haut est
                    bien celui qui s'applique au compte gratuit. */}
                <Text style={styles.tierLabel}>{t('onboarding.result.currentLabel')}</Text>
                <Text style={styles.tierCurrent}>{counted} €/h</Text>
                <Text style={styles.tierSub}>{t('onboarding.result.currentSub')}</Text>

                <View style={styles.resultDivider} />

                {/* Le seuil verrouillé n'arrive qu'une fois le premier chiffre
                    posé : les deux ensemble se liraient comme un seul bloc, et
                    l'écart perdrait son effet. */}
                <Animated.View
                  style={{
                    opacity: reveal.interpolate({ inputRange: [0.6, 1], outputRange: [0, 1] }),
                  }}
                >
                  <Text style={styles.tierLabel}>{t('onboarding.result.optimizedLabel')}</Text>
                  <View style={styles.lockedRow}>
                    <Text style={styles.resultValue}>••</Text>
                    <Text style={styles.lockedUnit}>€/h</Text>
                    <Feather name="lock" size={22} color={colors.primary} />
                  </View>
                </Animated.View>
              </>
            )}

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
                <Text style={styles.statValue}>{formatEuros(monthlyGoal ?? 0)}</Text>
                <Text style={styles.statLabel}>{t('onboarding.result.statNet')}</Text>
              </View>
            </View>

            <View style={styles.resultDivider} />

            {isPremium ? (
              <Text style={styles.resultNote}>
                {derived.flooredByProfitability
                  ? t('onboarding.result.floored')
                  : t('onboarding.result.fromGoal')}
              </Text>
            ) : null}
          </View>
        ) : null;
    }
  };

  /**
   * Le seuil qui vient d'être calculé n'est appliqué qu'aux offres des abonnés :
   * en gratuit, `DashboardScreen` force FREE_THRESHOLDS pour tout le monde. On le
   * dit ici, au seul moment où le chauffeur a son propre chiffre sous les yeux et
   * peut mesurer l'écart. Rien à afficher s'il est déjà abonné.
   */
  const renderPlusPitch = () => {
    if (step !== 'result' || !derived || isPremium) return null;
    return (
      <Animated.View
        style={[
          styles.plusCard,
          { opacity: reveal.interpolate({ inputRange: [0.8, 1], outputRange: [0, 1] }) },
        ]}
      >
        <Feather name="unlock" size={18} color={colors.primary} />
        <Text style={styles.plusTitle}>{t('onboarding.result.plusTitle')}</Text>
      </Animated.View>
    );
  };

  const title = t(`onboarding.${step}.title`);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Chevron de retour puis barre de progression pleine largeur. Pas de
          sortie : les cinq réponses produisent le seuil de rentabilité, et sans
          elles le reste de l'app n'a rien à calculer. */}
      <View style={styles.header}>
        {/* Rendu conditionnel plutôt qu'une couleur transparente : le glyphe
            restait dessiné et se voyait sur le fond sombre. */}
        {index === 0 ? (
          <View style={styles.backSpacer} />
        ) : (
          <TouchableOpacity
            onPress={() => go(index - 1)}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.back', 'Retour')}
          >
            <Feather name="chevron-left" size={26} color={colors.primary} />
          </TouchableOpacity>
        )}

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((index + 1) / STEPS.length) * 100}%` }]} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          style={[
            styles.stepWrap,
            {
              opacity: anim,
              // Fondu pur, sans translation : la question répondue s'estompe sur
              // place et la suivante se pose au même endroit. Le léger recul en
              // échelle suffit à donner de la profondeur au passage — un
              // déplacement vertical ferait lire l'arrivée comme une liste qui
              // remonte, ce qui n'est pas le propos.
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
              ],
            },
          ]}
        >
          <Text style={styles.title}>{title}</Text>
          <View style={styles.stepContent}>{renderStep()}</View>
          {renderPlusPitch()}
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.cta, !canContinue && styles.ctaDisabled]}
          onPress={onPrimary}
          activeOpacity={0.88}
          disabled={saving || !canContinue}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canContinue }}
          accessibilityLabel={isLast ? t('onboarding.start') : t('onboarding.next')}
        >
          <Text style={[styles.ctaTxt, !canContinue && styles.ctaTxtDisabled]}>
            {isLast ? t('onboarding.start') : t('onboarding.next')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 14,
  },
  backSpacer: { width: 26 },
  // Barre épaisse et pleinement arrondie, qui court sur toute la largeur restante :
  // c'est elle qui porte la notion d'avancement, d'où la disparition du compteur
  // « Étape n sur 6 » qui disait deux fois la même chose.
  progressTrack: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },

  body: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  // Le titre est ancré en haut — il tombe au même endroit d'une question à
  // l'autre — et les réponses se centrent dans la hauteur qui reste. Les caler
  // en haut elles aussi laissait un grand vide sous les questions à trois
  // réponses, et un écran plein sous celles à six.
  stepWrap: { flex: 1, width: '100%' },

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
  stepContent: { width: '100%', flex: 1, justifyContent: 'center' },

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
  tierLabel: {
    color: colors.textMuted,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tierCurrent: {
    color: colors.textMain,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: 4,
  },
  tierSub: { color: colors.textDimmed, fontSize: 12.5, marginTop: 2 },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  lockedUnit: { color: colors.primary, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
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

  // Une ligne, pas un paragraphe : le chiffre masqué juste au-dessus dit déjà
  // ce qu'il y a à gagner, un texte de vente en dessous ne ferait que le diluer.
  plusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.primary + '3A',
  },
  plusTitle: { color: colors.primary, fontSize: 15, fontWeight: '800' },

  footer: { paddingHorizontal: 24, paddingBottom: 24 },
  // Pilule pleine à toutes les étapes. Le dégradé gris des étapes intermédiaires
  // se lisait comme un bouton désactivé alors qu'il était bien actif.
  cta: {
    width: '100%',
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  ctaDisabled: { backgroundColor: 'rgba(255,255,255,0.12)' },
  ctaTxt: {
    color: colors.background,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  ctaTxtDisabled: { color: colors.textDimmed },
});

export default OnboardingScreen;
