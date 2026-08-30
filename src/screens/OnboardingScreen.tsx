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

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Animated,
  Easing,
  Image,
  Platform,
  ScrollView,
} from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import SafeGradient from '../components/SafeGradient';
import { useTranslation } from 'react-i18next';
import * as Sentry from '@sentry/react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { hapticLight, hapticSuccess } from '../utils/haptics';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import { getPlusPackages } from '../services/iapService';
import {
  deriveThreshold,
  SOCIAL_RATES,
  DriverStatus,
} from '../utils/incomeGoal';
import {
  getEffectivePlanTier,
  FREE_THRESHOLDS,
  fetchPlanLimits,
} from '../services/subscriptionService';
import { useReduceMotion } from '../hooks/useReduceMotion';
import ScanPreview from '../components/ScanPreview';

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
const HOURS_CHOICES: (number | null)[] = [30, 35, 40, 45, 50, null];
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
  `${Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;

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
const STEPS = ['demo', 'hours', 'goal', 'costs', 'status', 'computing', 'result'] as const;

/// Les quatre étapes annoncées pendant le calcul — ce sont EXACTEMENT celles de
/// `deriveThreshold`, dans l'ordre où il les exécute. Rien d'inventé : annoncer
/// un travail qui n'a pas lieu serait un mensonge posé dans la vitrine, et
/// surtout ça raterait l'objectif. Un chiffre expliqué avant d'être affiché
/// n'arrive pas comme une affirmation arbitraire.
const COMPUTE_STEPS = ['gross', 'costs', 'hours', 'km'] as const;

/// Plancher de l'écran de calcul.
///
/// Le calcul lui-même est une division : il ne prend rien. Mais l'écran couvre
/// du travail RÉEL — écriture des préférences, rechargement des paliers, et
/// surtout préchargement de l'offre RevenueCat pour que le paywall s'ouvre sans
/// attente derrière. On attend le plus lent des deux, jamais moins de ça.
///
/// Deux secondes, pas cinq : au-delà de trois, le coût en abandons dépasse le
/// gain de crédibilité, et on est ici juste avant l'écran qui doit vendre.
const MIN_COMPUTE_MS = 2000;

/// Diamètre et épaisseur de l'anneau de progression.
const RING = 168;
/// Quarante graduations : assez pour que la lumière tourne sans à-coup, assez
/// peu pour qu'on distingue chaque barre s'allumer.
const TICKS = Array.from({ length: 40 }, (_, i) => i);
const TICK_RADIUS = RING / 2 - 10;
type Step = (typeof STEPS)[number];

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
      easing:
        toValue === 1 ? Easing.out(Easing.quad) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

  return (
    <Animated.View
      style={
        reduceMotion
          ? undefined
          : {
              transform: [
                {
                  scale: press.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 0.98],
                  }),
                },
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

/// Vrai flou : ANDROID SEULEMENT, et à partir de l'API 31.
///
/// `filter: [{ blur }]` de React Native s'appuie sur `RenderEffect` côté
/// Android — un flou gaussien natif, lisse, vérifié à l'émulateur. L'app
/// descendant à l'API 24, le repli couvre Android 7 à 11.
///
/// ⚠️ PAS sur iOS, malgré le support annoncé. Dans
/// `RCTViewComponentView.mm`, le chemin du flou est derrière le feature flag
/// `enableSwiftUIBasedFilters` et, quand il est actif, il REPARENTE tous les
/// sous-vues dans un conteneur SwiftUI puis les rend à la vue d'origine. Deux
/// issues, mauvaises toutes les deux : flag éteint, le flou est ignoré en
/// silence et le seuil s'affiche en clair — on donne ce qu'on fait payer ;
/// flag allumé, ce reparentage s'applique à une vue qui porte une opacité
/// animée par le pilote natif et qui est démontée à la sortie de l'écran.
///
/// iOS prend donc la pastille. Elle est nette, elle assume d'être un masque, et
/// elle ne dépend d'aucune API récente.
const CAN_BLUR =
  Platform.OS === 'android' &&
  typeof Platform.Version === 'number' &&
  Platform.Version >= 31;

/**
 * Nombre masqué : flou gaussien natif là où la plateforme le sait, pastille
 * pleine ailleurs.
 *
 * Le repli n'imite pas le flou — il assume autre chose. Empiler des copies
 * décalées donnait un gribouillis ; une pastille à la taille exacte du nombre
 * se lit comme une valeur reprise, pas comme un rendu raté. Ce qui lève
 * l'ambiguïté, c'est la séquence : le chauffeur a vu les chiffres défiler à
 * découvert avant que ça se couvre. Masqué d'entrée, le même bloc passerait
 * pour du contenu qui n'a pas chargé — c'était le défaut de la version
 * caviardée d'origine.
 *
 * Positionné en absolu par-dessus la copie nette, qui garde la place dans le
 * flux et donne donc la boîte à couvrir.
 */
const BlurredNumber = ({
  text, style, mask,
}: { text: string; style: StyleProp<TextStyle>; mask: StyleProp<ViewStyle> }) =>
  CAN_BLUR
    ? <Text style={[style, styles.blurCopySolo]}>{text}</Text>
    : <View style={mask} />;

/** Le bouton principal interpole sa couleur de fond entre eteint et allume. */
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const OnboardingScreen = ({
  onFinish,
}: {
  /// `openPaywall` distingue les deux sorties de l'écran final. Le paywall n'est
  /// pas ouvert ici mais par `RootNavigator`, qui sait aussi marquer l'onboarding
  /// comme vu et rafraîchir le profil — trois choses qui doivent arriver
  /// ensemble. Sortir en naviguant directement les sautait toutes les trois.
  onFinish?: (opts?: { openPaywall?: boolean }) => void;
}) => {
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

  /** Statut déduit du taux — « autre » dès que le taux est saisi à la main. */
  const driverStatus: DriverStatus =
    (Object.keys(SOCIAL_RATES) as (keyof typeof SOCIAL_RATES)[]).find(
      k => socialRate !== null && SOCIAL_RATES[k] === socialRate,
    ) ?? 'autre';

  const derived =
    monthlyGoal !== null &&
    weeklyHours !== null &&
    fixedCosts !== null &&
    socialRate !== null
      ? deriveThreshold({ monthlyGoal, weeklyHours, fixedCosts, socialRate, status: driverStatus })
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
    // Rien à répondre, et rien à toucher : l'écran avance tout seul.
    computing: true,
    result: true,
  };
  const canContinue = answered[step];

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
    if (reduceMotion) {
      progress.setValue(toValue);
      return;
    }
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
    if (reduceMotion) {
      ctaOn.setValue(toValue);
      return;
    }
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

  /// Remise à zéro avant peinture, pas après.
  ///
  /// L'écran n'est pas remonté entre deux passages : `counted` gardait donc la
  /// valeur de la visite précédente, et comme la montée démarre après 260 ms de
  /// délai, le seuil s'affichait en clair pendant ce temps-là — on voyait « 69 »
  /// avant de le voir monter. `useEffect` arriverait trop tard : il s'exécute
  /// après le rendu, la valeur périmée aurait déjà été peinte.
  useLayoutEffect(() => {
    if (step === 'result') setCounted(0);
  }, [step]);

  /// La séquence de l'écran de conversion, en trois temps.
  ///
  ///   1. le chiffre MONTE depuis zéro — l'app calcule sous ses yeux ;
  ///   2. il se POSE, net, assez longtemps pour être lu ;
  ///   3. il se FLOUTE, et l'offre arrive.
  ///
  /// L'ordre fait tout : on ne peut pas vouloir récupérer un chiffre qu'on n'a
  /// jamais vu. Le masquer d'entrée — ce que faisait le placeholder « — — » —
  /// ne crée aucun manque, seulement l'impression d'un écran à moitié rendu.
  ///
  /// Le flou est un VRAI flou, sans dépendance native : `textShadowRadius` sur
  /// un glyphe transparent ne peint que l'ombre diffuse des chiffres. On lit
  /// « il y a un nombre », jamais le nombre.
  /// Avancement de l'écran de calcul : 0 → 1 sur `MIN_COMPUTE_MS`.
  /// Deux valeurs pour une seule progression.
  ///
  /// `compute` pilote TOUT le visuel — quarante graduations, les phrases — au
  /// pilote natif : quarante opacités interpolées à chaque frame passeraient mal
  /// par le pont JS. `computeJs` ne sert qu'au pourcentage, qui doit être lu
  /// depuis JS pour être affiché en texte. Même durée, même courbe, lancées
  /// ensemble : elles ne peuvent pas se désynchroniser.
  const compute = useRef(new Animated.Value(0)).current;
  const computeJs = useRef(new Animated.Value(0)).current;
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (step !== 'computing') return;
    let cancelled = false;
    const startedAt = Date.now();

    compute.setValue(0);
    computeJs.setValue(0);
    setPct(0);
    const id = computeJs.addListener(({ value }) => setPct(Math.round(value * 100)));
    const ease = Easing.inOut(Easing.quad);
    Animated.parallel([
      Animated.timing(compute, {
        toValue: 1, duration: MIN_COMPUTE_MS, easing: ease, useNativeDriver: true,
      }),
      Animated.timing(computeJs, {
        toValue: 1, duration: MIN_COMPUTE_MS, easing: ease, useNativeDriver: false,
      }),
    ]).start();

    // Le VRAI travail. Il a lieu ici plutôt qu'à la sortie de l'onboarding :
    // c'est le seul moment où le chauffeur regarde sans rien attendre, et
    // précharger l'offre RevenueCat maintenant fait ouvrir le paywall sans
    // délai quand il touche « Appliquer mon taux avec Plus ».
    //
    // `allSettled` : aucun de ces trois travaux n'est bloquant. Un échec de
    // réseau ne doit pas retenir le chauffeur devant une barre figée.
    const work = Promise.allSettled([
      user?.id && derived
        ? supabase.from('preferences').upsert({
            id: user.id,
            monthly_goal: monthlyGoal,
            weekly_hours: weeklyHours,
            fixed_costs: fixedCosts,
            driver_status: driverStatus,
            social_rate: socialRate,
            min_hourly_rate: derived.hourly,
            min_km_rate: derived.km,
          })
        : Promise.resolve(),
      fetchPlanLimits(),
      getPlusPackages(),
    ]);

    work.then(() => {
      if (cancelled) return;
      const wait = Math.max(0, MIN_COMPUTE_MS - (Date.now() - startedAt));
      setTimeout(() => { if (!cancelled) go(index + 1); }, wait);
    });

    return () => { cancelled = true; computeJs.removeListener(id); };
    // `go` et les réponses sont stables une fois l'étape atteinte : les mettre
    // en dépendance relancerait la séquence à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const derivedHourly = derived?.hourly ?? null;

  /// Le flou s'installe au moment exact où le compteur DÉPASSE le seuil gratuit.
  ///
  /// Tant que le chiffre monte dans ce que le gratuit accorde déjà, il n'y a
  /// rien à cacher : le chauffeur le lit. Au-delà de 25 €/h commence ce qu'il
  /// n'a pas — et c'est précisément là que ça devient illisible. Le flou cesse
  /// d'être un rideau tiré arbitrairement : il marque une frontière.
  ///
  /// Dérivé de `reveal` plutôt que joué à part, donc rigoureusement synchrone
  /// avec le compteur — impossible que le flou arrive avant ou après le passage.
  const blurStart = Math.min(0.98, FREE_THRESHOLDS.hourly / (derivedHourly || FREE_THRESHOLDS.hourly));
  const blurProgress = reveal.interpolate({
    inputRange: [blurStart, Math.min(1, blurStart + 0.18)],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const pitchAnim = useRef(new Animated.Value(0)).current;

  /// Arrivée en cascade de l'écran final.
  ///
  /// Une seule valeur, et chaque élément lit une TRANCHE différente de sa course.
  /// C'est ce qui donne l'ordre de lecture — le filet, le sur-titre, la règle,
  /// le chiffre, la comparaison, l'explication — au lieu d'un bloc qui apparaît
  /// d'un coup et où l'œil ne sait pas par où commencer.
  const intro = useRef(new Animated.Value(0)).current;
  /// Part de la barre du gratuit : 25 €/h rapportés au seuil calculé. C'est la
  /// proportion qui porte l'argument — plus le seuil est haut, plus la barre du
  /// gratuit paraît courte, et l'écart se voit sans qu'on ait à le nommer.
  const freeShare = derivedHourly
    ? Math.min(100, Math.round((FREE_THRESHOLDS.hourly / derivedHourly) * 100))
    : 100;

  /// Les barres poussent depuis la gauche. `transformOrigin` évite de connaître
  /// leur largeur : `scaleX` seul les ferait grandir depuis leur centre.
  const barGrow = (from: number, to: number) => ({
    transform: [{
      scaleX: intro.interpolate({
        inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp',
      }),
    }],
  });

  const enterAt = (from: number, to: number) => ({
    opacity: intro.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{
      translateY: intro.interpolate({
        inputRange: [from, to], outputRange: [18, 0], extrapolate: 'clamp',
      }),
    }],
  });

  useEffect(() => {
    if (step !== 'result') return;
    // Sous « Reduire les animations », le seuil est POSE, pas joue : le chiffre
    // affiche sa valeur finale et l'ecart est a sa hauteur. On ne prive personne
    // de l'information, on retire la mise en scene.
    if (reduceMotion) {
      reveal.setValue(1);
      intro.setValue(1);
      setCounted(derivedHourly ?? FREE_THRESHOLDS.hourly);
      pitchAnim.setValue(1);
      return;
    }
    reveal.setValue(0);
    pitchAnim.setValue(0);
    intro.setValue(0);

    const target = derivedHourly ?? FREE_THRESHOLDS.hourly;
    const id = reveal.addListener(({ value }) => setCounted(Math.round(value * target)));

    const seq: Animated.CompositeAnimation[] = [
      Animated.timing(reveal, {
        toValue: 1,
        duration: 1100,
        delay: 260,
        easing: Easing.out(Easing.cubic),
        // Le compteur lit la valeur depuis JS : le pilote natif la rendrait
        // inaccessible et le chiffre resterait figé à zéro.
        useNativeDriver: false,
      }),
      // Un temps d'arrêt sur le chiffre arrivé — flouté — avant d'offrir la clé.
      Animated.delay(650),
    ];
    seq.push(Animated.timing(pitchAnim, {
      toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }));

    const sequence = Animated.parallel([
      Animated.timing(intro, {
        toValue: 1, duration: 1150, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.sequence(seq),
    ]);
    sequence.start();
    return () => { sequence.stop(); reveal.removeListener(id); };
  }, [step, reveal, pitchAnim, intro, reduceMotion, derivedHourly]);

  const go = (next: number) => {
    // L'écran de calcul ne se traverse QUE vers l'avant : il repart tout seul
    // dès qu'on l'atteint, donc y revenir en arrière renvoyait aussitôt au
    // résultat — le chevron « retour » ne servait plus à rien depuis la
    // dernière page. On l'enjambe.
    if (STEPS[next] === 'computing' && next < index) {
      go(next - 1);
      return;
    }
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
      toValue: 0,
      duration: out,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setIndex(next);
      Animated.timing(anim, {
        toValue: 1,
        duration: back,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const finish = async (openPaywall = true) => {
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
          ...(derived
            ? { min_hourly_rate: derived.hourly, min_km_rate: derived.km }
            : {}),
        });
      }
    } catch (e) {
      // On laisse passer l'utilisateur, mais pas l'échec : c'est le seul endroit
      // où ces réponses sont écrites. Un catch réellement muet ici signifierait
      // perdre l'onboarding de tout le parc sans jamais l'apprendre.
      Sentry.captureException(e, { tags: { flow: 'onboarding_save' } });
    } finally {
      setSaving(false);
      if (onFinish) onFinish({ openPaywall });
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
      current === null
        ? ''
        : isPercent
        ? String(Math.round(current * 100))
        : String(current),
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
    choices,
    value,
    onPick,
    unit,
    zeroLabel,
    labelFor,
    subFor,
    isPercent,
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
            const active = isOther
              ? value !== null && !onAnOption
              : c === value;
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
                  if (isOther) {
                    openDraft(value, !!isPercent);
                    return;
                  }
                  setEditing(null);
                  onPick(c as number);
                }}
              >
                <Text
                  style={[styles.optionTxt, active && styles.optionTxtActive]}
                >
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
        // Traitement propre à cette étape, et c'est voulu : la carte est le
        // HÉROS de l'écran — la seule chose que le chauffeur voit avant qu'on
        // lui demande quoi que ce soit. À sa taille d'origine elle occupait
        // 250 px de haut sur 1500 disponibles, et les 1250 restants se lisaient
        // comme un écran inachevé. Grossie et recentrée, le vide devient de la
        // présence. Les questions, elles, restent ancrées sous leur titre.
        return (
          <View style={styles.demoWrap}>
            <ScanPreview />
          </View>
        );

      case 'hours':
        return (
          <OptionList
            choices={HOURS_CHOICES}
            value={weeklyHours}
            onPick={setWeeklyHours}
            unit=" h"
          />
        );

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
            labelFor={v =>
              v === 0 ? t('onboarding.costs.none') : formatEuros(v)
            }
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
              v === SOCIAL_RATES.auto_entrepreneur
                ? t('onboarding.status.auto')
                : v === SOCIAL_RATES.societe
                ? t('onboarding.status.company')
                : t('onboarding.status.employee')
            }
            // Le taux AVEC sa base. Les deux chiffres ne portent pas sur la même
            // chose — 21 % du chiffre d'affaires contre 45 % de la rémunération —
            // et posés nus côte à côte ils feraient conclure que la société coûte
            // deux fois plus cher, ce qui est faux.
            subFor={v =>
              v === SOCIAL_RATES.auto_entrepreneur
                ? t('onboarding.status.autoSub')
                : v === SOCIAL_RATES.societe
                ? t('onboarding.status.companySub')
                : t('onboarding.status.employeeSub')
            }
          />
        );

      case 'computing':
        return (
          <View style={styles.computeWrap}>
            {/* Couronne de graduations. Quarante barres posées sur le cercle,
                chacune tournée de son angle puis poussée vers l'extérieur —
                `rotate` PUIS `translateY`, l'ordre compte : la translation se
                fait dans le repère déjà tourné. Chacune s'allume quand la
                progression atteint sa part, ce qui fait tourner la lumière
                autour du cercle. Pas de `react-native-svg` dans le projet, et
                l'ajouter pour cet écran imposerait un module natif à installer
                aussi côté iOS. */}
            <View style={styles.ring}>
              <View style={styles.ringInner} />
              {TICKS.map(i => {
                const at = i / TICKS.length;
                return (
                  <Animated.View
                    key={i}
                    style={[
                      styles.tick,
                      {
                        opacity: compute.interpolate({
                          inputRange: [at, Math.min(1, at + 0.02)],
                          outputRange: [0.13, 1],
                          extrapolate: 'clamp',
                        }),
                        transform: [
                          { rotate: `${at * 360}deg` },
                          { translateY: -TICK_RADIUS },
                        ],
                      },
                    ]}
                  />
                );
              })}
              <Text style={styles.ringPct}>
                {pct}
                <Text style={styles.ringPctSign}> %</Text>
              </Text>
            </View>

            {/* Une phrase à la fois, qui monte en entrant et sort par le haut.
                Les quatre superposées dans une boîte de hauteur fixe : rien ne
                bouge autour d'elles quand elles se remplacent. */}
            <View style={styles.phraseBox}>
              {COMPUTE_STEPS.map((k, i) => {
                const seg = 1 / COMPUTE_STEPS.length;
                const from = i * seg;
                const to = (i + 1) * seg;
                const last = i === COMPUTE_STEPS.length - 1;
                return (
                  <Animated.Text
                    key={k}
                    style={[
                      styles.phrase,
                      {
                        opacity: compute.interpolate({
                          inputRange: [from, from + 0.05, to - 0.05, to],
                          // La dernière ne s'efface pas : l'écran disparaît sur elle.
                          outputRange: [0, 1, 1, last ? 1 : 0],
                          extrapolate: 'clamp',
                        }),
                        transform: [{
                          translateY: compute.interpolate({
                            inputRange: [from, from + 0.05, to - 0.05, to],
                            outputRange: [14, 0, 0, last ? 0 : -14],
                            extrapolate: 'clamp',
                          }),
                        }],
                      },
                    ]}
                  >
                    {t(`onboarding.computing.${k}`)}
                  </Animated.Text>
                );
              })}
            </View>
          </View>
        );

      case 'result': {
        if (!derived) return null;
        const locked = derived.hourly > FREE_THRESHOLDS.hourly && !isPremium;
        const personalRate = `${derived.hourly.toFixed(0)} €/h`;
        return (
          <View style={styles.decision}>
            <Animated.Text style={[styles.decisionKicker, enterAt(0.04, 0.24)]}>
              {t('onboarding.result.decisionKicker')}
            </Animated.Text>
            <Animated.Text style={[styles.decisionPrompt, enterAt(0.12, 0.38)]}>
              {locked
                ? t('onboarding.result.lockedPrompt')
                : t('onboarding.result.readyPrompt')}
            </Animated.Text>

            {/* Un PANNEAU, pas une suite de lignes.
                Le chiffre et la comparaison forment un seul objet posé sur le
                fond : c'est ce qui distingue un écran composé d'un empilement de
                paragraphes. Deux barres remplacent les deux lignes de texte —
                l'écart entre le gratuit et son seuil se VOIT au lieu de se lire,
                et c'est tout l'argument de l'écran. */}
            <Animated.View style={[styles.panel, enterAt(0.24, 0.56)]}>
              <SafeGradient
                colors={['rgba(0,230,118,0.10)', 'rgba(0,230,118,0.02)']}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />

              <View style={styles.rateBlock}>
                <View>
                  <Animated.Text
                    style={[
                      styles.rateValue,
                      locked
                        ? { opacity: blurProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }
                        : null,
                    ]}
                  >
                    {counted} €/h
                  </Animated.Text>
                  {locked ? (
                    <Animated.View
                      style={[
                        styles.blurLayer,
                        CAN_BLUR ? styles.blurFilterBig : null,
                        { opacity: blurProgress },
                      ]}
                    >
                      <BlurredNumber
                        text={`${counted} €/h`}
                        style={styles.rateValue}
                        mask={styles.maskPillBig}
                      />
                    </Animated.View>
                  ) : null}
                </View>
                {/* La marque plutôt qu'un cadenas : le flou dit déjà que c'est
                    verrouillé, et un cadenas de plus n'ajoute qu'un symbole de
                    refus. Le badge, lui, nomme ce qui ouvre. */}
                <View style={styles.plusBadge}>
                  <Image
                    source={require('../assets/strive-logo.png')}
                    style={styles.plusBadgeLogo}
                  />
                  <Text style={styles.plusBadgeTxt}>{t('tier.plusName')}</Text>
                </View>
              </View>
              <Text style={styles.rateLabel}>
                {t('onboarding.result.yoursCaption')}
              </Text>

              <View style={styles.bars}>
                <View style={styles.barRow}>
                  <Text style={styles.barLabel}>
                    {t('onboarding.result.freeApplies')}
                  </Text>
                  <View style={styles.barTrack}>
                    <Animated.View
                      style={[
                        styles.barFill,
                        styles.barFillFree,
                        { width: `${freeShare}%` },
                        barGrow(0.42, 0.72),
                      ]}
                    />
                  </View>
                  <Text style={styles.barValue}>{FREE_THRESHOLDS.hourly} €/h</Text>
                </View>

                <View style={styles.barRow}>
                  <Text style={styles.barLabelOn}>
                    {t('onboarding.result.yoursLabel')}
                  </Text>
                  <View style={styles.barTrack}>
                    <Animated.View style={[styles.barFill, barGrow(0.5, 0.86)]}>
                      <SafeGradient
                        colors={['rgba(0,230,118,0.55)', colors.primary]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={StyleSheet.absoluteFillObject}
                      />
                    </Animated.View>
                  </View>
                  <View style={styles.barValueEnd}>
                    {locked ? (
                      <View>
                        <Animated.Text
                          style={[
                            styles.barValueOn,
                            { opacity: blurProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
                          ]}
                        >
                          {counted} €/h
                        </Animated.Text>
                        <Animated.View
                          style={[
                            styles.blurLayer,
                            CAN_BLUR ? styles.blurFilterSmall : null,
                            { opacity: blurProgress },
                          ]}
                        >
                          <BlurredNumber
                            text={`${counted} €/h`}
                            style={styles.barValueOn}
                            mask={styles.maskPillSmall}
                          />
                        </Animated.View>
                      </View>
                    ) : (
                      <Text style={styles.barValueOn}>{personalRate}</Text>
                    )}
                  </View>
                </View>
              </View>
            </Animated.View>

            <Animated.Text style={[styles.decisionExplanation, enterAt(0.56, 0.86)]}>
              {locked
                ? t('onboarding.result.lockedBody')
                : t('onboarding.result.floored')}
            </Animated.Text>
            <Animated.Text style={[styles.answersLine, enterAt(0.68, 1)]}>
              {t('onboarding.result.answersLine', {
                goal: formatEuros(monthlyGoal ?? 0),
                hours: derived.monthlyHours,
                revenue: formatEuros(derived.requiredRevenue),
              })}
            </Animated.Text>
          </View>
        );
      }
    }
  };

  const showUnlock =
    step === 'result' &&
    !!derived &&
    !isPremium &&
    derived.hourly > FREE_THRESHOLDS.hourly;

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
                {
                  scale: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.title}>{title}</Text>
          {desc ? <Text style={styles.desc}>{desc}</Text> : null}
          <View style={styles.stepContent}>{renderStep()}</View>
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        {/* Rien pendant le calcul : l'écran avance seul, et un bouton inerte
            n'inviterait qu'à taper dessus. */}
        {step === 'computing' ? null : showUnlock ? (
          // L'offre n'arrive qu'APRÈS le flou : tant que le chiffre est encore
          // net, rien ne doit détourner l'œil de lui. C'est le troisième temps
          // de la séquence.
          <Animated.View
            style={{
              opacity: pitchAnim,
              transform: [{
                translateY: pitchAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
              }],
            }}
          >
            <TouchableOpacity
              style={styles.unlockCta}
              activeOpacity={0.88}
              onPress={() => {
                hapticLight();
                // Pas de `navigate` direct : `finish` écrit les réponses, marque
                // l'onboarding vu, rafraîchit le profil, PUIS laisse
                // `RootNavigator` ouvrir le paywall. En naviguant d'ici, le
                // chauffeur revenait sur cet écran en fermant le paywall — et on
                // lui proposait « continuer sans » après qu'il ait payé.
                finish(true);
              }}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.result.unlockCta')}
            >
              <Text style={styles.unlockCtaTxt}>
                {t('onboarding.result.unlockCta')}
              </Text>
              <Feather
                name="arrow-up-right"
                size={19}
                color={colors.background}
              />
            </TouchableOpacity>
            <Text style={styles.unlockReassurance}>
              {t('onboarding.result.unlockReassurance')}
            </Text>
            <TouchableOpacity
              style={styles.laterBtn}
              // Le libellé dit « sans » : c'est la seule sortie qui ne doit pas
              // enchaîner sur le paywall.
              onPress={() => finish(false)}
              disabled={saving}
              accessibilityRole="button"
            >
              <Text style={styles.laterTxt}>
                {t('onboarding.result.later')}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
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
            accessibilityLabel={
              isLast ? t('onboarding.start') : t('onboarding.next')
            }
          >
            <Text
              style={[styles.ctaTxt, !canContinue && styles.ctaTxtDisabled]}
            >
              {isLast ? t('onboarding.start') : t('onboarding.next')}
            </Text>
          </AnimatedTouchable>
        )}
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
  // Les réponses sont ANCRÉES sous la question, elles ne flottent plus au centre.
  // Avec `flex: 1, justifyContent: 'center'`, quatre cartes dans 1400 px de haut
  // laissaient ~350 px de vide AU-DESSUS et autant en dessous : le bloc paraissait
  // perdu, et l'écran inachevé. Le centrage visait les questions à trois réponses,
  // mais un vide unique sous le contenu se lit comme de la place laissée exprès,
  // là où deux vides symétriques se lisent comme une erreur de mise en page.
  // Les questions à six réponses débordent dans le ScrollView, qui est là pour ça.
  // `flexGrow` et non `flex` : le conteneur prend la hauteur restante SANS
  // l'imposer à ses enfants. Une liste de réponses reste donc collée sous le
  // titre, tandis que la démonstration, qui demande `flex: 1`, se recentre dans
  // tout l'espace. Une seule règle, deux comportements selon ce qu'on y met.
  stepContent: { width: '100%', flexGrow: 1, marginTop: 34 },

  // Recentrage vertical, sans agrandissement. `ScanPreview` est déjà en pleine
  // largeur : une transformation d'échelle la faisait déborder des deux côtés,
  // coins arrondis coupés — elle ne peut gagner qu'en HAUTEUR, ce qui se règle
  // dans le composant lui-même et non ici. Le recentrage suffit à supprimer
  // l'effet d'écran inachevé : deux vides équilibrés se lisent comme de la
  // respiration, un vide de 1000 px sous le contenu comme un oubli.
  // Retrait latéral EN PLUS des 24 px de la page : la carte de résultat ne doit
  // pas courir d'un bord à l'autre. C'est un objet posé sur l'écran, pas un
  // bandeau — l'espace de chaque côté est ce qui le fait lire comme tel.
  demoWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 10 },

  // ── Cartes de réponse ──────────────────────────────────────────────────────
  optionList: { gap: 12 },
  option: {
    minHeight: 72,
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  // Sélection en aplat plein plutôt qu'en teinte légère : sur fond sombre, un
  // fond à 11 % d'opacité se distingue mal de l'état par défaut, surtout en
  // plein soleil dans une voiture.
  optionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
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
  markUnit: {
    color: colors.primary,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  redactRow: {
    flexDirection: 'row',
    gap: 5,
    alignSelf: 'flex-end',
    marginBottom: 4,
  },
  redact: {
    width: 22,
    height: 34,
    borderRadius: 5,
    backgroundColor: colors.primary + '4D',
  },
  markCaption: { color: colors.textMuted, fontSize: 14, marginLeft: 2 },

  dashRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  dash: {
    width: 6,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.primary + '80',
  },

  // La bande grandit depuis le bas : elle se déploie à partir du seuil acquis
  // vers celui qui manque, ce qui donne à l'écart un sens de lecture.
  gapBand: {
    height: 104,
    backgroundColor: colors.primary + '14',
    transformOrigin: 'bottom',
  },

  solidLine: { height: 2, borderRadius: 1, backgroundColor: colors.textMain },

  // ── Décision de course ────────────────────────────────────────────────────
  // Une feuille de route, pas un tableau de bord : le contraste vient des
  // règles typographiques et des lignes fonctionnelles, jamais d'un effet.
  decision: { paddingTop: 6 },
  decisionKicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  decisionPrompt: {
    color: colors.textMain,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
    letterSpacing: -0.7,
    maxWidth: 310,
  },
  rateBlock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rateValue: {
    color: colors.primary,
    fontSize: 58,
    lineHeight: 62,
    fontWeight: '900',
    letterSpacing: -2.8,
  },
  // Couche de flou : occupe exactement la boîte de la copie nette, qui reste
  // dans le flux et donne donc la taille.
  blurLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  computeWrap: { marginTop: 36, alignItems: 'center' },

  // ── Couronne de graduations ──
  ring: {
    width: RING, height: RING,
    alignItems: 'center', justifyContent: 'center',
  },
  ringInner: {
    position: 'absolute',
    width: RING - 56, height: RING - 56, borderRadius: (RING - 56) / 2,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.14)',
  },
  tick: {
    position: 'absolute',
    width: 3, height: 14, borderRadius: 2,
    backgroundColor: colors.primary,
  },
  ringPct: {
    color: colors.textMain, fontSize: 42, fontWeight: '900', letterSpacing: -1.6,
  },
  ringPctSign: { color: colors.textDimmed, fontSize: 18, fontWeight: '800' },

  // ── Phrase courante ──
  phraseBox: { height: 58, marginTop: 34, alignSelf: 'stretch', justifyContent: 'center' },
  phrase: {
    position: 'absolute', left: 0, right: 0,
    color: colors.textMain, fontSize: 16, fontWeight: '600',
    textAlign: 'center', lineHeight: 23,
  },

  panel: {
    marginTop: 26,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.16)',
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
    overflow: 'hidden',
  },
  plusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingLeft: 8, paddingRight: 12, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,230,118,0.13)',
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.30)',
  },
  plusBadgeLogo: { width: 18, height: 18, borderRadius: 6 },
  plusBadgeTxt: {
    color: colors.textMain, fontSize: 11, fontWeight: '900', letterSpacing: 1.2,
  },
  bars: { marginTop: 24, gap: 14 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  barLabel: { color: colors.textDimmed, fontSize: 12, width: 84 },
  barLabelOn: { color: colors.textMain, fontSize: 12, fontWeight: '700', width: 84 },
  barTrack: {
    flex: 1, height: 8, borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%', width: '100%', borderRadius: 4,
    transformOrigin: 'left center',
  },
  barFillFree: { backgroundColor: 'rgba(255,255,255,0.22)' },
  barValue: { color: colors.textDimmed, fontSize: 13, fontWeight: '700', width: 58, textAlign: 'right' },
  barValueEnd: { width: 58, alignItems: 'flex-end' },
  barValueOn: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  maskPillBig: { flex: 1, borderRadius: 14, backgroundColor: 'rgba(0,230,118,0.28)' },
  maskPillSmall: { flex: 1, borderRadius: 7, backgroundColor: 'rgba(0,230,118,0.28)' },
  blurCopySolo: { position: 'absolute', top: 0, left: 0 },
  blurFilterBig: { filter: [{ blur: 11 }] },
  blurFilterSmall: { filter: [{ blur: 5 }] },
  rateLabel: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
  },
  decisionExplanation: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 20,
    maxWidth: 350,
  },

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
  plusPersonal: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 2,
  },

  footer: { paddingHorizontal: 24, paddingBottom: 24 },
  unlockCta: {
    minHeight: 62,
    paddingHorizontal: 24,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    shadowColor: '#00FF8C',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  unlockCtaTxt: {
    color: colors.background,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  unlockReassurance: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 9,
  },
  laterBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 1 },
  laterTxt: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
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
