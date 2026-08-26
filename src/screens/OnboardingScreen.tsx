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
import { useReduceMotion } from '../hooks/useReduceMotion';
import ScanPreview from '../components/ScanPreview';

/**
 * Segments du trait discontinu marquant le seuil personnel. Construit à la main
 * plutôt qu'avec `borderStyle: 'dashed'`, dont le rendu diffère entre iOS et
 * Android et se déforme dès qu'une bordure est arrondie.
 */
const DASHES = Array.from({ length: 34 }, (_, i) => i);

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

/**
 * Une démonstration, les quatre questions, puis l'écran de résultat.
 *
 * LA DÉMONSTRATION D'ABORD, et c'est le seul changement d'ordre. Avant elle, on
 * demandait quatre chiffres puis de l'argent à quelqu'un qui n'avait jamais vu
 * l'app faire son travail. Les dix onboardings les mieux notés du marché ont
 * tous le même réflexe — première action utile en moins d'une minute, Duolingo
 * repoussant même la création de compte après elle — et c'était le seul écart
 * structurel entre eux et ce flux.
 *
 * On montre la surface RÉELLE, l'îlot dynamique, pas une abstraction : c'est là
 * que le verdict apparaîtra pour de vrai, puisqu'on scanne depuis une autre app.
 * Et elle est tapable : trois courses, une bonne, une moyenne, une mauvaise.
 *
 * « platforms » ouvrait la marche et n'y a plus sa place. L'en-tête de ce
 * fichier annonce d'ailleurs « les quatre faits qui permettent de calculer le
 * seuil » : la cinquième question n'en était pas un. `deriveThreshold` ne s'en
 * sert pas, `preferences.platforms` n'est relu nulle part dans l'app, et le
 * scanner apprend la plateforme tout seul à chaque course — elle est écrite sur
 * chaque `rides.platform`.
 *
 * C'était donc une collecte posée AVANT la valeur, sur l'écran où l'on décroche
 * le plus : celui qui n'a encore rien reçu. Quatre questions au lieu de cinq,
 * c'est vingt pour cent de chemin en moins jusqu'au chiffre qui justifie le
 * formulaire.
 */
const STEPS = ['demo', 'hours', 'goal', 'costs', 'status', 'result'] as const;
type Step = typeof STEPS[number];

/**
 * Carte de réponse. C'est le geste répété de tout l'onboarding — quatre
 * questions, une carte par ligne — donc le seul qui mérite une réponse au doigt.
 * `docs/DESIGN.md` la définit : « les cartes interactives se réduisent
 * légèrement (0.98) plutôt que de changer de couleur. Réponse tactile, pas
 * signal visuel. » D'où `activeOpacity={1}` : l'échelle porte le retour, le voile
 * gris de TouchableOpacity ferait doublon et brouillerait l'état sélectionné.
 *
 * Composant de MODULE, et pas une fonction déclarée dans le corps de l'écran :
 * là-bas React en recrée le type à chaque rendu, démonte la carte et repose sa
 * valeur animée — l'appui n'aurait jamais le temps de se voir.
 *
 * Descente asymétrique : 90 ms pour s'enfoncer, 160 pour revenir. L'enfoncement
 * doit suivre le doigt, le retour peut se permettre d'être vu.
 */
const OptionCard = ({
  active,
  reduceMotion,
  onPress,
  children,
  accessibilityRole,
  accessibilityState,
}: {
  active: boolean;
  reduceMotion: boolean;
  onPress: () => void;
  children: React.ReactNode;
  accessibilityRole?: 'button' | 'checkbox';
  accessibilityState?: { selected?: boolean; checked?: boolean };
}) => {
  const press = useRef(new Animated.Value(0)).current;
  const to = (toValue: number) =>
    Animated.timing(press, {
      toValue,
      duration: toValue === 1 ? 90 : 160,
      easing: toValue === 1 ? Easing.out(Easing.quad) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

  return (
    <Animated.View
      style={
        reduceMotion
          ? undefined
          : {
              transform: [
                { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] }) },
              ],
            }
      }
    >
      <TouchableOpacity
        style={[styles.option, active && styles.optionActive]}
        activeOpacity={1}
        onPressIn={reduceMotion ? undefined : () => to(1)}
        onPressOut={reduceMotion ? undefined : () => to(0)}
        onPress={onPress}
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
};

/** Le bouton principal interpole sa couleur de fond entre eteint et allume. */
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const OnboardingScreen = ({ onFinish }: { onFinish?: () => void }) => {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const navigation = useNavigation<any>();
  const isPremium = getEffectivePlanTier(profile) !== 'free';
  // « Reduire les animations » : tout ce qui suit degrade en fondu, jamais en
  // suppression — l'ecran doit rester lisible et les etats rester distincts.
  const reduceMotion = useReduceMotion();

  const [index, setIndex] = useState(0);
  const step: Step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  // Aucune réponse pré-cochée : une valeur par défaut est une réponse que le
  // chauffeur n'a pas donnée, et elle produit pourtant un seuil de rentabilité
  // qu'il croira être le sien. `null` = pas encore répondu, et le bouton
  // « Continuer » reste inactif tant que c'est le cas.
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
    // Rien à répondre : on regarde. L'écran n'existe que pour donner une raison
    // aux quatre questions qui suivent.
    demo: true,
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

  // ── Progression ───────────────────────────────────────────────────────────
  // Elle sautait d'un pas a l'autre. C'est pourtant le seul element qui reponde
  // a « ou j'en suis, et combien il reste » : un saut ne raconte rien, un
  // parcours si. `scaleX` et non `width` — la largeur passe par la mise en page
  // a chaque image, la transformation part sur le pilote natif.
  const progress = useRef(new Animated.Value(1 / STEPS.length)).current;
  useEffect(() => {
    const toValue = (index + 1) / STEPS.length;
    if (reduceMotion) { progress.setValue(toValue); return; }
    Animated.timing(progress, {
      toValue,
      // Plus long que la transition de contenu (320 ms) : la barre doit encore
      // avancer quand la question suivante est deja lisible, sinon on ne la voit
      // pas bouger — on la retrouve simplement plus loin.
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [index, progress, reduceMotion]);

  // ── Etat du bouton principal ──────────────────────────────────────────────
  // Il s'allume quand la question est repondue. Le basculement etait sec ; une
  // transition courte le rattache au geste qui vient d'avoir lieu.
  const ctaOn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const toValue = canContinue ? 1 : 0;
    if (reduceMotion) { ctaOn.setValue(toValue); return; }
    Animated.timing(ctaOn, {
      toValue,
      duration: canContinue ? 180 : 120,
      easing: Easing.out(Easing.quad),
      // La couleur de fond s'interpole, ce que le pilote natif ne sait pas
      // faire. Un seul bouton, deux images par seconde de transition : le cout
      // est nul, et l'alternative — un fondu croise de deux vues superposees —
      // couterait une vue pour rien.
      useNativeDriver: false,
    }).start();
  }, [canContinue, ctaOn, reduceMotion]);

  // ── Révélation du résultat ────────────────────────────────────────────────
  // Le dernier écran est le seul qui affiche un chiffre produit par les
  // réponses : il s'écrit en montant depuis zéro plutôt que d'apparaître fait.
  // C'est le seul endroit de l'onboarding qui mérite qu'on s'y arrête.
  const reveal = useRef(new Animated.Value(0)).current;
  const [counted, setCounted] = useState(0);

  useEffect(() => {
    if (step !== 'result') return;
    // Sous « Reduire les animations », le seuil est POSE, pas joue : le chiffre
    // affiche sa valeur finale et l'ecart est a sa hauteur. On ne prive personne
    // de l'information, on retire la mise en scene.
    if (reduceMotion) {
      setCounted(FREE_THRESHOLDS.hourly);
      reveal.setValue(1);
      return;
    }
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
  }, [step, reveal, reduceMotion]);

  const go = (next: number) => {
    if (next < 0 || next >= STEPS.length) return;
    hapticLight();
    setEditing(null);
    // La question répondue s'efface en reculant — fondu plus léger recul en
    // échelle, ce qui la fait lire comme « emportée » plutôt que simplement
    // masquée — puis la suivante revient de l'avant. Sortie brève et entrée
    // deux fois plus longue : c'est le déséquilibre qui donne la sensation de
    // réponse au doigt.
    // Sous « Reduire les animations », la sortie et l'entree restent — sans
    // elles la question changerait sans qu'on sache qu'elle a change — mais le
    // recul en echelle tombe et les durees se resserrent : il reste un fondu,
    // ce que recommande Apple en remplacement d'un deplacement.
    const out = reduceMotion ? 90 : 160;
    const back = reduceMotion ? 140 : 320;
    Animated.timing(anim, {
      toValue: 0, duration: out, easing: Easing.in(Easing.quad), useNativeDriver: true,
    }).start(() => {
      setIndex(next);
      Animated.timing(anim, {
        toValue: 1, duration: back, easing: Easing.out(Easing.cubic), useNativeDriver: true,
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
              <OptionCard
                key={i}
                active={active}
                reduceMotion={reduceMotion}
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
              </OptionCard>
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
      case 'demo':
        return <ScanPreview />;

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
        if (!derived) return null;
        return (
          // Un seuil est une ligne : au-dessus, la course vaut le coup ; en
          // dessous, elle coûte de l'argent. On la dessine donc, plutôt que de
          // poser le chiffre dans une carte. La bande teintée entre le seuil
          // standard et le sien est exactement ce qu'il laisse passer aujourd'hui
          // — l'écart argumente tout seul, sans phrase de vente.
          <View>
            <Animated.View
              style={{
                opacity: reveal.interpolate({ inputRange: [0.55, 1], outputRange: [0, 1] }),
              }}
            >
              <View style={styles.markRow}>
                {isPremium ? (
                  <Text style={styles.markValue}>{derived.hourly.toFixed(0)} €/h</Text>
                ) : (
                  <>
                    {/* Deux barres caviardées plutôt que des points de
                        suspension : elles occupent la place exacte d'un nombre
                        à deux chiffres et se lisent comme une valeur masquée,
                        là où des puces typographiques flottaient au-dessus de
                        la ligne de base. */}
                    <View style={styles.redactRow}>
                      <View style={styles.redact} />
                      <View style={styles.redact} />
                    </View>
                    <Text style={styles.markUnit}>€/h</Text>
                    <Feather name="lock" size={19} color={colors.primary} />
                  </>
                )}
                <Text style={styles.markCaption}>{t('onboarding.result.yoursCaption')}</Text>
              </View>
              <View style={styles.dashRow}>
                {DASHES.map(i => <View key={i} style={styles.dash} />)}
              </View>
            </Animated.View>

            <Animated.View
              style={[
                styles.gapBand,
                {
                  transform: [{
                    scaleY: reveal.interpolate({ inputRange: [0.55, 1], outputRange: [0, 1] }),
                  }],
                },
              ]}
            />

            <View style={styles.solidLine} />
            <View style={styles.markRow}>
              <Text style={[styles.markValue, styles.markValueStd]}>{counted} €/h</Text>
              <Text style={styles.markCaption}>{t('onboarding.result.standardCaption')}</Text>
            </View>

            {/* Ses propres réponses, en une ligne : elles rendent le calcul
                vérifiable sans reconstruire un tableau de statistiques. */}
            <Text style={styles.answersLine}>
              {t('onboarding.result.answersLine', {
                goal: formatEuros(monthlyGoal ?? 0),
                hours: derived.monthlyHours,
                revenue: formatEuros(derived.requiredRevenue),
              })}
            </Text>
          </View>
        );
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
        style={{ opacity: reveal.interpolate({ inputRange: [0.8, 1], outputRange: [0, 1] }) }}
      >
        <TouchableOpacity
          style={styles.plusCard}
          activeOpacity={0.85}
          onPress={() => {
            hapticLight();
            navigation.navigate('SubscriptionScreen');
          }}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.result.plusTitle')}
        >
          <Feather name="unlock" size={20} color={colors.primary} />
          <View style={styles.plusTexts}>
            <Text style={styles.plusTitle}>{t('onboarding.result.plusTitle')}</Text>
            {/* Ses propres chiffres, repris tels qu'il vient de les donner :
                c'est ce qui distingue cette ligne d'un encart promotionnel. */}
            <Text style={styles.plusPersonal}>
              {t('onboarding.result.plusPersonal', {
                goal: formatEuros(monthlyGoal ?? 0),
                hours: derived.monthlyHours,
              })}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.primary} />
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const title = t(`onboarding.${step}.title`);
  // Chaque question porte deja sa phrase d'explication en traduction — elle n'a
  // simplement jamais ete affichee. Les apps qui disent POURQUOI elles posent une
  // question convertissent nettement mieux que celles qui posent sechement ;
  // celle-ci etait ecrite, dans les deux langues, et dormait dans le fichier.
  // `defaultValue` vide : l'ecran de resultat n'en a pas, et `t()` rendrait la
  // cle elle-meme.
  const desc = t(`onboarding.${step}.desc`, { defaultValue: '' });

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
          <Animated.View
            style={[styles.progressFill, { transform: [{ scaleX: progress }] }]}
          />
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
          {desc ? <Text style={styles.desc}>{desc}</Text> : null}
          <View style={styles.stepContent}>{renderStep()}</View>
          {renderPlusPitch()}
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <AnimatedTouchable
          style={[
            styles.cta,
            {
              backgroundColor: ctaOn.interpolate({
                inputRange: [0, 1],
                outputRange: ['rgba(255,255,255,0.12)', colors.primary],
              }),
            },
          ]}
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
        </AnimatedTouchable>
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
  progressFill: {
    height: '100%',
    // Pleine largeur, mise a l'echelle depuis le bord GAUCHE : sans
    // `transformOrigin`, la barre grandirait par son centre et deborderait a
    // gauche autant qu'elle avance a droite.
    width: '100%',
    transformOrigin: 'left',
    backgroundColor: colors.primary,
    // Pas d'arrondi ici : mis a l'echelle, il s'ecraserait en ellipse. La piste
    // porte le sien et rogne le depassement.
  },

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

  // La phrase d'explication : plus proche du titre que des reponses, elle en est
  // la suite et non un element a part.
  desc: {
    color: colors.textDimmed,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 4,
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

  // ── Ligne de seuil ─────────────────────────────────────────────────────────
  // Aucune carte, aucun filet décoratif : les deux seuls traits de l'écran sont
  // les deux seuils eux-mêmes, et ils portent du sens.
  markRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  markValue: {
    color: colors.primary,
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1.8,
  },
  // Le seuil standard est celui qui s'applique vraiment aujourd'hui : il reste
  // en blanc, couleur du fait acquis. Le vert est réservé à ce qui se débloque.
  markValueStd: { color: colors.textMain },
  markUnit: { color: colors.primary, fontSize: 26, fontWeight: '900', letterSpacing: -0.8 },
  redactRow: { flexDirection: 'row', gap: 5, alignSelf: 'flex-end', marginBottom: 4 },
  redact: { width: 22, height: 34, borderRadius: 5, backgroundColor: colors.primary + '4D' },
  markCaption: { color: colors.textMuted, fontSize: 14, marginLeft: 2 },

  dashRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  dash: { width: 6, height: 2, borderRadius: 1, backgroundColor: colors.primary + '80' },

  // La bande grandit depuis le bas : elle se déploie à partir du seuil acquis
  // vers celui qui manque, ce qui donne à l'écart un sens de lecture.
  gapBand: {
    height: 104,
    backgroundColor: colors.primary + '14',
    transformOrigin: 'bottom',
  },

  solidLine: { height: 2, borderRadius: 1, backgroundColor: colors.textMain },

  answersLine: {
    color: colors.textDimmed,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 22,
  },

  // Une ligne, pas un paragraphe : le chiffre masqué juste au-dessus dit déjà
  // ce qu'il y a à gagner, un texte de vente en dessous ne ferait que le diluer.
  plusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.primary + '3A',
  },
  plusTexts: { flex: 1 },
  plusTitle: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  plusPersonal: { color: colors.textMuted, fontSize: 12.5, lineHeight: 17, marginTop: 2 },

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
