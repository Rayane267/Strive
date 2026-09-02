import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Animated,
  Platform,
  Linking,
  AppState,
  Alert,
  Image,
} from 'react-native';
import Video from 'react-native-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { hapticLight, hapticSuccess } from '../utils/haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { registerPushToken, getNotificationStatus } from '../services/notificationService';
import { openSettingsFor, openShortcutsApp } from '../utils/appSettings';
/// LE MÊME composant que la première page de l'onboarding, pas une imitation.
/// Son propre commentaire est formel : ces chiffres sont la vitrine du produit
/// et ne doivent pas diverger d'un écran à l'autre. Ici il ne présente plus le
/// produit — c'est fait depuis longtemps — il montre la SORTIE des quatre gestes
/// qu'on vient d'apprendre, à l'endroit exact où l'étape 3 dit « lisez le
/// verdict ». Et il reste tapable : trois courses, une bonne, une moyenne, une
/// mauvaise.
import ScanPreview from '../components/ScanPreview';

const { width, height } = Dimensions.get('window');

// Démo AssistiveTouch (muette, en boucle) affichée dans le slide déclencheur iOS.
const ASSISTIVE_VIDEO = require('../assets/assistivetouch.mov');

/**
 * APERÇU MULTIPLATEFORME — DÉVELOPPEMENT UNIQUEMENT.
 *
 * Le tutoriel iOS ne se relit pas sur un poste sans iPhone : c'est celui qui
 * contient le raccourci, AssistiveTouch et le récap, donc celui qu'on doit
 * pouvoir regarder. Poser 'ios' ici le rend tel quel sur un appareil Android.
 *
 *   'ios'    → force le parcours iOS (aperçu depuis Android)
 *   'android'→ force le parcours Android (aperçu depuis iOS)
 *   null     → parcours réel de l'appareil
 *
 * À laisser sur null : c'est un outil d'aperçu, pas un réglage. Une valeur
 * forcée ici part telle quelle dans un build de production.
 */
const PREVIEW_OS: 'ios' | 'android' | null = null;
const OS: 'ios' | 'android' = (PREVIEW_OS ?? Platform.OS) as 'ios' | 'android';
const IS_IOS = OS === 'ios';

/**
 * MISE EN PAGE — pourquoi elle ressemble à l'onboarding, et pas à autre chose.
 *
 * L'écran d'avant empilait tous les signaux du gabarit générique : halos en
 * dégradé derrière chaque icône, cercle lumineux en fond de page, cartes
 * translucides bordées, pastilles « ÉTAPE n », encart d'astuce à éclair, bouton
 * en dégradé avec une flèche dans un rond — et tout centré. Beaucoup de
 * décoration, aucune hiérarchie : rien ne disait où regarder.
 *
 * Le vocabulaire vient maintenant de deux endroits.
 *
 * 1. L'ONBOARDING DE STRIVE, écran par lequel le chauffeur vient d'arriver :
 *    même barre de progression épaisse, même pilule pleine largeur entièrement
 *    arrondie, même accent plein pour l'état choisi. Deux écrans consécutifs
 *    doivent se lire comme une seule application.
 *
 * 2. RIDEIQ, qui fait exactement ce travail-là (installer un raccourci et
 *    AssistiveTouch) : contenu à plat, aucune carte, titre lourd, corps de texte
 *    gris aéré, étapes numérotées en pastille pleine, filets de séparation fins,
 *    boutons pleine largeur sans icône.
 *
 * ALIGNEMENT À GAUCHE, et c'est la différence assumée avec l'onboarding : là-bas
 * une question centrée surplombe des réponses ; ici ce sont des consignes qu'on
 * exécute en les lisant. Un mode d'emploi se lit au fil du bord gauche, pas
 * depuis un axe central que l'œil doit retrouver à chaque ligne.
 *
 * Une seule couleur porte du sens (le vert de marque). L'ambre et le gris ne
 * servent qu'aux états du récapitulatif.
 */
const A = colors.primary;
/** Filet de séparation. La seule bordure de l'écran : plus de cartes. */
const HAIRLINE = 'rgba(255,255,255,0.09)';

/** Retraits de la diapositive. Partagés entre les styles et le calcul de la
 *  hauteur vidéo : deux valeurs séparées finiraient par diverger. */
const SLIDE_PAD_TOP = 16;
const SLIDE_PAD_BOTTOM = 32;
/** Espace sous le cadre vidéo, avant le reste du contenu. */
const VIDEO_GAP = 14;

/**
 * La démonstration du verdict est ici une ILLUSTRATION d'étape, pas le sujet de
 * la page comme elle l'est sur la première page de l'onboarding. À taille réelle
 * elle écrasait les quatre gestes qu'elle est censée servir.
 *
 * Mise à l'échelle plutôt que redimensionnée : `ScanPreview` est le composant
 * partagé, on ne touche pas à ses proportions ni à ses tailles de texte — on le
 * regarde d'un peu plus loin. L'origine en haut à gauche garde son bord aligné
 * sur celui du texte de l'étape.
 */
const PREVIEW_SCALE = 0.85;

/**
 * HAUTEUR DE LA DÉMO ASSISTIVETOUCH — MESURÉE, PAS DEVINÉE.
 *
 * Elle valait 30 % de la hauteur d'écran. Proportionnel n'est pas adaptatif :
 * sur un petit téléphone, 30 % d'un écran court laissent quand même trop peu
 * pour le titre, les quatre étapes et le bouton « Ouvrir les Réglages » — qui
 * est l'action de la diapositive. Et sur un grand, la vidéo reste petite alors
 * qu'il y avait la place.
 *
 * Même méthode que `computeOptionHeight` dans l'onboarding : on mesure les deux
 * grandeurs non circulaires — la fenêtre du ScrollView, et le bloc qui suit la
 * vidéo (lien de rejeu, titre, étapes, bouton) — et la vidéo prend ce qui reste.
 *
 * Les bornes : en bas 150 pt, en deçà desquels la capture d'un écran d'iPhone
 * n'est plus lisible et ne démontre plus rien — on préfère alors laisser la
 * diapositive défiler. En haut 34 % de l'écran, pour qu'elle n'écrase jamais les
 * étapes, qui sont le vrai contenu.
 */
const VIDEO_MIN_H = 150;
const VIDEO_MAX_H = height * 0.34;

const computeVideoHeight = (viewportH: number, belowH: number): number | undefined => {
  if (!viewportH || !belowH) return undefined;
  const free = viewportH - SLIDE_PAD_TOP - SLIDE_PAD_BOTTOM - belowH - VIDEO_GAP;
  return Math.max(VIDEO_MIN_H, Math.min(VIDEO_MAX_H, free));
};

/** Les quatre exigences de l'installation iOS. `notif` est la seule que l'app
 *  puisse vérifier ; `shortcut` ne peut être que DÉCLARÉE par le chauffeur ;
 *  les deux dernières n'ont aucune API et restent « à vérifier ». */
const RECAP_ROWS = [
  // Chaque exigence porte SA destination. Un unique bouton « Ouvrir les
  // Réglages » sous les quatre lignes obligeait le chauffeur à deviner laquelle
  // il allait régler — et le déposait au même endroit dans les quatre cas.
  { key: 'notif',    target: 'notifications' as const },
  // Le raccourci mène à l'app Raccourcis, pas aux Réglages : c'est là qu'on le
  // VOIT. iOS n'offre aucun moyen de vérifier son existence par programme, donc
  // la ligne ne prétend rien — elle emmène regarder, et affiche « confirmé » si
  // le chauffeur l'a déclaré à l'étape 2.
  { key: 'shortcut', target: 'shortcuts' as const },
  { key: 'bubble',   target: 'accessibility' as const },
  { key: 'urgent',   target: 'notifications' as const },
] as const;

/** Déclaration explicite du chauffeur : « j'ai ajouté le raccourci ». Ce n'est
 *  PAS une vérification — iOS n'en offre aucune — mais c'est la sienne, pas une
 *  supposition de l'app. Persisté pour que le récap s'en souvienne au rejeu. */
const SHORTCUT_DECLARED_KEY = '@strive_shortcut_declared';

/** Le nom EXACT du raccourci dans l'app Raccourcis. Non traduit — c'est un nom
 *  propre, et le chauffeur doit retrouver cette chaîne telle quelle dans sa
 *  liste. La changer ici sans la changer dans le raccourci iCloud enverrait
 *  chercher quelque chose qui n'existe pas. */
const SHORTCUT_NAME = 'Strive Shortcut';

/**
 * SÉQUENCE. Le tutoriel ne raconte plus le produit — l'onboarding l'a fait,
 * démo comprise, et il a déjà calculé et enregistré le seuil du chauffeur. Ce
 * qui reste ici est ce que lui seul peut faire : installer, puis apprendre les
 * deux gestes du quotidien (scanner, puis répondre prise/refusée).
 *
 * iOS     = 6 slides : Bienvenue · Installation · AssistiveTouch · Récap · Taguer · Antisèche
 * Android = 4 slides : Bienvenue · Installation · Taguer · Antisèche
 */
const STEPS = (IS_IOS
  ? [
      { key: 'welcome', titleKey: 'tutorial.step1.title',     descKey: 'tutorial.step1.desc',     tip: 'tutorial.tips.step1' },
      { key: 'install', titleKey: 'tutorial.step2_ios.title', descKey: 'tutorial.step2_ios.desc', tip: '' },
      // Ni titre ni sous-titre : la vidéo et les quatre étapes numérotées se
      // suffisent, et la hauteur ainsi rendue évite que le bouton du bas morde
      // sur l'étape « Ajouter Strive ».
      { key: 'trigger', titleKey: '',                         descKey: '',                        tip: '' },
      { key: 'recap',   titleKey: 'tutorial.recap.title',     descKey: 'tutorial.recap.desc',     tip: '' },
      { key: 'tag',     titleKey: 'tutorial.tag.title',       descKey: 'tutorial.tag.desc',       tip: '' },
      { key: 'done',    titleKey: 'tutorial.step5_ios.title', descKey: 'tutorial.step5_ios.desc', tip: '' },
    ]
  : [
      { key: 'welcome', titleKey: 'tutorial.step1.title', descKey: 'tutorial.step1.desc', tip: 'tutorial.tips.step1' },
      { key: 'install', titleKey: 'tutorial.step2.title', descKey: 'tutorial.step2.desc', tip: '' },
      { key: 'tag',     titleKey: 'tutorial.tag.title',   descKey: 'tutorial.tag.desc',   tip: '' },
      { key: 'done',    titleKey: 'tutorial.step5.title', descKey: 'tutorial.step5.desc', tip: '' },
    ]
) as readonly { key: string; titleKey: string; descKey: string; tip: string }[];

/** Les façons de répondre « prise / refusée », par plateforme. iOS a la carte
 *  Dynamic Island ; Android a les actions de la notification de résultat
 *  (`FloatingBubbleService`). Les deux retombent sur l'Historique, où les
 *  courses sans réponse restent « En attente ».
 *
 *  La commande vocale Siri a été retirée de cette liste. Les intents existent
 *  toujours côté natif (`StriveAppShortcuts`) et continuent de répondre — on ne
 *  l'ENSEIGNE simplement plus ici. */
const TAG_ROWS = IS_IOS
  ? [
      { key: 'di',    icon: 'cellphone-text' },
      { key: 'notif', icon: 'bell-outline' },
    ]
  : [
      { key: 'notif',   icon: 'bell-outline' },
      { key: 'history', icon: 'history' },
    ];

/** L'antisèche finale : la boucle complète, du geste de capture à la réponse qui
 *  remplit les statistiques. Même anatomie que les étapes d'installation —
 *  pastille numérotée, titre, sous-titre — plutôt qu'une carte à part. */
const QUICKREF_STEPS = [1, 2, 3, 4];

const TutorialScreen = ({ onFinish }: { onFinish?: () => void }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const closeTutorial = () => {
    if (onFinish) onFinish();
    else if (navigation.canGoBack()) navigation.goBack();
  };
  const flatListRef = useRef<FlatList>(null);
  const videoRef = useRef<any>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [currentIndex, setCurrentIndex] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  /** Le raccourci a été ouvert (lien iCloud) — on ne sait rien de plus. */
  const [shortcutOpened, setShortcutOpened] = useState(false);
  /** Le chauffeur a confirmé l'avoir ajouté. Sa parole, pas notre supposition. */
  const [shortcutDeclared, setShortcutDeclared] = useState(false);
  /// État réel de la permission notifications, relu sans jamais afficher la
  /// fenêtre système — elle ne s'affiche qu'une fois par installation, la brûler
  /// pour peindre un bouton en vert serait le pire échange.
  const [notifGranted, setNotifGranted] = useState(false);
  /** Les deux mesures qui dimensionnent la démo AssistiveTouch (cf.
   *  `computeVideoHeight`). La fenêtre est commune à toutes les diapositives —
   *  elles ont la même hauteur — et le bloc mesuré est celui qui suit la vidéo. */
  const [slideViewportH, setSlideViewportH] = useState(0);
  const [triggerBelowH, setTriggerBelowH] = useState(0);
  /** Hauteur NATURELLE de la démonstration, mesurée avant mise à l'échelle. Sans
   *  elle, la vue réduite garderait la place de la vue pleine taille et laisserait
   *  un trou de 15 % sous elle. */
  const [previewH, setPreviewH] = useState(0);

  /// « Prêt » exige DEUX conditions, pas une : la permission système accordée
  /// ET un jeton FCM enregistré. Le Profil se fie déjà au jeton, et son
  /// raisonnement est le bon — c'est lui qui décide si le serveur peut joindre
  /// l'appareil. Une permission accordée sans jeton (réseau coupé au moment de
  /// l'enregistrement) laisserait le chauffeur sans verdict alors que l'écran
  /// afficherait un vert rassurant. Les deux doivent tenir.
  const refreshNotifStatus = useCallback(async () => {
    const [status, token] = await Promise.all([
      getNotificationStatus(),
      AsyncStorage.getItem('@strive_fcm_token'),
    ]);
    setNotifGranted(status === 'granted' && !!token);
  }, []);

  useEffect(() => {
    refreshNotifStatus();
    AsyncStorage.getItem(SHORTCUT_DECLARED_KEY).then(v => {
      if (v === '1') { setShortcutDeclared(true); setShortcutOpened(true); }
    });
    // Le chauffeur peut accorder la permission depuis les Réglages iOS, hors de
    // l'app : on relit à chaque retour au premier plan plutôt que de rester sur
    // un état figé au montage.
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active') refreshNotifStatus();
    });
    return () => sub.remove();
  }, [refreshNotifStatus]);

  /// C'est CET appel qui affiche la fenêtre système. Il est ici et pas au
  /// démarrage parce que c'est le seul moment où le chauffeur a une raison de
  /// dire oui : on vient de lui expliquer que le verdict arrive par là.
  const enableNotifications = useCallback(async () => {
    if (!user?.id) return;
    const result = await registerPushToken(user.id, true);
    await refreshNotifStatus();
    // BOUTON MORT ÉVITÉ. La fenêtre système ne s'affiche qu'une fois par
    // installation : si le chauffeur avait déjà refusé, `requestPermission`
    // répond « non » de mémoire, sans rien montrer. Le bouton serait resté
    // orange à ne rien faire, et il aurait conclu que l'app est cassée.
    //
    // On DEMANDE avant d'ouvrir les Réglages, exactement comme l'interrupteur du
    // Profil, et avec les mêmes textes : le catapulter hors de l'app sans un mot
    // au milieu d'un tutoriel serait plus brutal que le problème qu'on résout.
    //
    // On teste le RÉSULTAT de la demande, et non l'état relu ensuite. L'ancienne
    // version envoyait aux Réglages dès que le statut n'était pas « accordé » —
    // ce qui incluait `unknown`, l'état rendu quand Firebase Messaging est
    // absent (simulateur, build sans Google Play Services). Le chauffeur était
    // alors envoyé dans des Réglages où les notifications sont déjà autorisées,
    // sans que la fenêtre système ne se soit jamais affichée. `unavailable`
    // n'est pas un refus : on se tait.
    if (result === 'denied') {
      Alert.alert(
        t('preferences.pushDeniedTitle'),
        t('preferences.pushDeniedBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('preferences.openSettings'), onPress: () => openSettingsFor('notifications') },
        ],
      );
    }
  }, [user?.id, refreshNotifStatus, t]);

  const isLast = currentIndex === STEPS.length - 1;


  const goToIndex = (index: number) => {
    hapticLight();
    flatListRef.current?.scrollToIndex({ index, animated: true });
    setCurrentIndex(index);
    Animated.spring(progressAnim, {
      toValue: index,
      useNativeDriver: false,
      tension: 50,
      friction: 7,
    }).start();
  };

  const handleNext = () => {
    if (!isLast) {
      goToIndex(currentIndex + 1);
    } else {
      hapticSuccess();
      closeTutorial();
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const newIndex = viewableItems[0].index;
      setCurrentIndex(newIndex);
      Animated.spring(progressAnim, {
        toValue: newIndex,
        useNativeDriver: false,
        tension: 50,
        friction: 7,
      }).start();
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  // URL iCloud du raccourci pré-construit (« Prendre une capture » + « Analyser
  // une course avec Strive »).
  const PREBUILT_SHORTCUT_URL = 'https://www.icloud.com/shortcuts/d678e4a771654387866c5621e97cc58a';

  /// OUVRIR N'EST PAS INSTALLER. On note seulement que le chauffeur est parti
  /// vers l'app Raccourcis : il a pu annuler la feuille d'ajout, et rien dans
  /// iOS ne nous le dira. C'est pourquoi le vert n'arrive qu'après sa
  /// confirmation explicite, jamais ici.
  const openShortcut = () => {
    Linking.openURL(PREBUILT_SHORTCUT_URL).catch(() => openShortcutsApp());
    setShortcutOpened(true);
  };

  const declareShortcut = () => {
    hapticSuccess();
    setShortcutDeclared(true);
    AsyncStorage.setItem(SHORTCUT_DECLARED_KEY, '1');
  };

  /// Chaque ligne du récap mène à SA destination — le raccourci vers l'app
  /// Raccourcis (là où on le voit, pas dans les Réglages), la bulle vers
  /// l'accessibilité, les notifications vers leur page. Sur iOS, seule la page
  /// des notifications est atteignable directement ; l'accessibilité retombe sur
  /// la fiche de l'app, où les étapes numérotées de la slide précédente donnent
  /// le chemin. Voir `utils/appSettings`.
  const openRecapTarget = (target: 'notifications' | 'accessibility' | 'shortcuts') => {
    hapticLight();
    if (target === 'shortcuts') {
      openShortcutsApp();
      return;
    }
    openSettingsFor(target);
  };

  const restartVideo = () => {
    hapticLight();
    videoRef.current?.seek(0);
  };

  /**
   * L'UNITÉ DE BASE DES TROIS PAGES À ÉTAPES : installation, AssistiveTouch,
   * antisèche. Pastille numérotée, trait qui descend vers la suivante, titre,
   * sous-titre — et ce qu'on veut poser dessous (`children`) : un bouton, une
   * démonstration.
   *
   * Le trait est ce qui sépare ça d'une liste à puces : il dit que les étapes
   * s'enchaînent dans cet ordre, et il tient la colonne de texte alignée d'un
   * bout à l'autre de la page. Surtout, ce qui vit sous une étape lui APPARTIENT
   * visiblement — le bouton « Activer les notifications » est dans la colonne de
   * l'étape 1, au lieu de flotter entre deux étapes sans propriétaire.
   */
  const LoopStep = ({
    n,
    title,
    sub,
    isLast,
    children,
  }: {
    n: number;
    title: string;
    sub?: string;
    isLast?: boolean;
    children?: React.ReactNode;
  }) => (
    <View style={styles.loopRow}>
      <View style={styles.loopRail}>
        <View style={styles.stepNum}>
          <Text style={styles.stepNumTxt}>{n}</Text>
        </View>
        {!isLast ? <View style={styles.loopConnector} /> : null}
      </View>
      <View style={[styles.loopTexts, isLast && styles.loopTextsLast]}>
        <Text style={styles.loopTitle}>{title}</Text>
        {sub ? <Text style={styles.stepSub}>{sub}</Text> : null}
        {children}
      </View>
    </View>
  );

  const renderStep = ({ item, index }: { item: typeof STEPS[number]; index: number }) => {
    // Fondu seul. L'échelle 0,7 → 1 et la translation verticale faisaient
    // « arriver » chaque diapositive comme une animation de présentation ; le
    // glissement horizontal dit déjà tout ce qu'il y a à dire.
    const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
    const opacity = scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });

    const tipText = t(item.tip, { defaultValue: '' });
    const isInstall = item.key === 'install';
    const isTrigger = item.key === 'trigger';
    const isRecap = item.key === 'recap';
    const isTag = item.key === 'tag';
    const isDone = item.key === 'done';
    const isWelcome = item.key === 'welcome';
    const videoHeight = computeVideoHeight(slideViewportH, triggerBelowH);

    return (
      <View style={styles.slide}>
        <ScrollView
          style={styles.slideScroll}
          contentContainerStyle={[
            styles.slideContent,
            !isInstall && !isTrigger && styles.slideContentCentered,
            isWelcome && styles.slideContentAxis,
          ]}
          showsVerticalScrollIndicator={false}
          onLayout={e => setSlideViewportH(e.nativeEvent.layout.height)}
        >
          <Animated.View style={{ width: '100%', opacity }}>

            {/* Seule la page de garde porte un visuel d'en-tête, et c'est le logo
                de l'app. Les tuiles à pictogramme des autres pages sont parties :
                un symbole générique au-dessus d'un titre qui dit déjà tout
                n'ajoutait rien, et ses 82 px poussaient le troisième bouton de la
                page d'installation sous le pied de page. */}
            {isWelcome ? (
              <Image source={require('../assets/strive-logo.png')} style={[styles.iconLogo, styles.centerSelf]} />
            ) : null}

            {item.titleKey ? <Text style={styles.title}>{t(item.titleKey)}</Text> : null}
            {item.descKey ? <Text style={styles.desc}>{t(item.descKey)}</Text> : null}

            {/* L'astuce d'accueil : un paragraphe gris, pas un encart à éclair. */}
            {tipText ? <Text style={styles.tip}>{tipText}</Text> : null}

            {/* ── Installation ─────────────────────────────────────────────
                 Un réglage, son explication, son bouton juste dessous : l'action
                 est là où on vient de comprendre pourquoi elle sert. Les
                 notifications valent pour les DEUX plateformes ; seul le
                 raccourci est propre à iOS. */}
            {isInstall ? (
              <View style={styles.block}>
                <LoopStep
                  n={1}
                  isLast={!IS_IOS}
                  title={t('tutorial.iosInstall.notifT')}
                  sub={IS_IOS ? t('tutorial.iosInstall.notifS') : t('tutorial.iosInstall.notifS_android')}
                >
                  <TouchableOpacity
                    style={[styles.cta, notifGranted && styles.ctaDone]}
                    onPress={enableNotifications}
                    activeOpacity={0.85}
                    disabled={notifGranted}
                  >
                    <Text style={[styles.ctaTxt, notifGranted && styles.ctaDoneTxt]}>
                      {notifGranted
                        ? t('tutorial.iosInstall.notifDone')
                        : t('tutorial.iosInstall.notifCta')}
                    </Text>
                  </TouchableOpacity>
                </LoopStep>

                {IS_IOS ? (
                  <>
                    <LoopStep
                      n={2}
                      title={t('tutorial.iosInstall.shortcutT')}
                      sub={t('tutorial.iosInstall.shortcutS')}
                    >
                      <TouchableOpacity
                        style={[styles.cta, shortcutOpened && styles.ctaGhost]}
                        onPress={openShortcut}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.ctaTxt, shortcutOpened && styles.ctaGhostTxt]}>
                          {shortcutOpened ? t('tutorial.iosInstall.ctaDone') : t('tutorial.iosInstall.cta')}
                        </Text>
                      </TouchableOpacity>

                      {/* LE VERT NE S'ALLUME QUE SUR SA PAROLE. Avant, il suffisait
                          que le lien s'ouvre pour lire « Raccourci installé » — y
                          compris quand le chauffeur avait annulé l'ajout. Le récap,
                          deux slides plus loin, disait pourtant l'inverse. iOS ne
                          nous a rien appris depuis : on demande, on n'invente pas. */}
                      {shortcutOpened && !shortcutDeclared ? (
                        <TouchableOpacity style={styles.cta} onPress={declareShortcut} activeOpacity={0.85}>
                          <Text style={styles.ctaTxt}>{t('tutorial.iosInstall.confirmCta')}</Text>
                        </TouchableOpacity>
                      ) : null}

                      {shortcutDeclared ? (
                        <View style={styles.confirmedRow}>
                          <MaterialCommunityIcons name="check-circle" size={16} color={A} />
                          <Text style={styles.confirmedTxt}>{t('tutorial.iosInstall.confirmed')}</Text>
                        </View>
                      ) : null}
                    </LoopStep>

                    {/* TROISIÈME RÉGLAGE, et non plus une simple ligne « à vérifier »
                        dans le récapitulatif. Sans lui, le mode Conduite — que
                        beaucoup de chauffeurs laissent actif en roulant — retient
                        le verdict au moment précis où il sert. iOS n'expose aucune
                        API pour le lire ni le poser : tout ce qu'on peut faire est
                        de l'expliquer et d'ouvrir la bonne page. C'est déjà
                        infiniment mieux que de l'apprendre en découvrant que rien
                        ne s'affiche. */}
                    <LoopStep
                      n={3}
                      isLast
                      title={t('tutorial.iosInstall.urgentT')}
                      sub={t('tutorial.iosInstall.urgentS')}
                    >
                      <TouchableOpacity
                        style={styles.cta}
                        onPress={() => openSettingsFor('notifications')}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.ctaTxt}>{t('tutorial.iosInstall.urgentCta')}</Text>
                      </TouchableOpacity>
                    </LoopStep>

                  </>
                ) : null}
              </View>
            ) : null}

            {/* ── AssistiveTouch ────────────────────────────────────────── */}
            {isTrigger ? (
              <View style={styles.block}>
                <View style={[styles.videoFrame, videoHeight != null && { height: videoHeight }]}>
                  <Video
                    ref={videoRef}
                    source={ASSISTIVE_VIDEO}
                    style={styles.videoPlayer}
                    resizeMode="contain"
                    repeat
                    muted
                    paused={currentIndex !== index}
                    playInBackground={false}
                    playWhenInactive={false}
                    ignoreSilentSwitch="ignore"
                  />
                </View>

                {/* Tout ce qui suit la vidéo est mesuré d'un bloc : c'est ce qui
                    doit tenir, et la vidéo prend le reste. */}
                <View onLayout={e => setTriggerBelowH(e.nativeEvent.layout.height)}>
                {/* Sous le cadre, et non par-dessus : la pastille flottante était
                    plus large que la vidéo depuis qu'elle a pris le format d'un
                    téléphone, et débordait des deux côtés. Un lien discret ne
                    peut pas déborder, et ne cache pas la démonstration. */}
                <TouchableOpacity
                  style={styles.videoReplay}
                  onPress={restartVideo}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('tutorial.restartVideo', 'Revoir la vidéo')}
                >
                  <Feather name="rotate-ccw" size={12} color={colors.textMuted} />
                  <Text style={styles.videoReplayTxt}>{t('tutorial.restartVideo', 'Revoir la vidéo')}</Text>
                </TouchableOpacity>

                <Text style={styles.title}>{t('tutorial.iosTrigger.assistive.hero')}</Text>

                {[1, 2, 3, 4].map((n, i, arr) => {
                  const title = t(`tutorial.iosTrigger.assistive.step${n}t`, { defaultValue: '' });
                  if (!title) return null;
                  return (
                    <LoopStep
                      key={n}
                      n={n}
                      isLast={i === arr.length - 1}
                      title={title}
                      sub={t(`tutorial.iosTrigger.assistive.step${n}s`)}
                    />
                  );
                })}

                <TouchableOpacity
                  style={styles.cta}
                  onPress={() => openSettingsFor('accessibility')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.ctaTxt}>{t('tutorial.iosTrigger.ctaSettings')}</Text>
                </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* ── Récapitulatif ─────────────────────────────────────────────
                 POURQUOI TOUT N'EST PAS VERT. Une seule de ces quatre lignes est
                 réellement vérifiable : les notifications. Le raccourci ne peut
                 être que déclaré par le chauffeur, et il est affiché comme tel —
                 « confirmé par vous », pas « prêt ». iOS n'expose AUCUNE API pour
                 AssistiveTouch ni pour le niveau d'interruption : ces deux-là
                 restent « à vérifier », avec le chemin pour le faire soi-même.
                 Peindre un faux vert serait bien pire que d'admettre l'ignorance. */}
            {isRecap ? (
              <View style={styles.blockList}>
                {RECAP_ROWS.map((row, index) => {
                  // Trois natures. Les notifications sont réellement vérifiées
                  // (permission + jeton). Le raccourci ne peut être que DÉCLARÉ
                  // par le chauffeur à l'étape 2 — affiché « confirmé », jamais
                  // « prêt ». La bulle AssistiveTouch n'expose aucune API et
                  // reste « à vérifier ».
                  const state = row.key === 'notif'
                    ? (notifGranted ? 'ok' : 'todo')
                    : row.key === 'shortcut' && shortcutDeclared
                    ? 'declared'
                    : 'unknown';
                  const stateColor = state === 'ok' || state === 'declared'
                    ? A
                    : state === 'todo'
                    ? '#FFB300'
                    : colors.textDimmed;
                  return (
                    <TouchableOpacity
                      key={row.key}
                      style={[styles.recapRow, index < RECAP_ROWS.length - 1 && styles.recapRowDivided]}
                      onPress={() => openRecapTarget(row.target)}
                      activeOpacity={0.6}
                      accessibilityRole="button"
                      accessibilityLabel={`${t(`tutorial.recap.${row.key}T`)} — ${t(`tutorial.recap.state_${state}`)}`}
                    >
                      <MaterialCommunityIcons
                        name={
                          state === 'ok' ? 'check-circle'
                          : state === 'declared' ? 'check-circle-outline'
                          : state === 'todo' ? 'alert-circle'
                          : 'help-circle'
                        }
                        size={21}
                        color={stateColor}
                      />
                      <View style={styles.recapBody}>
                        {/* Titre et état sur la même ligne, description et chemin
                            EN DESSOUS et sur toute la largeur. Avant, la
                            description partageait sa ligne avec l'étiquette
                            d'état : sa largeur changeait donc d'une ligne à
                            l'autre selon que l'état disait « À ACTIVER » ou
                            « À VÉRIFIER », et les quatre paragraphes se
                            coupaient chacun à un endroit différent. */}
                        <View style={styles.recapHead}>
                          <Text style={styles.recapTitle}>{t(`tutorial.recap.${row.key}T`)}</Text>
                          <Text style={[styles.recapState, { color: stateColor }]}>
                            {t(`tutorial.recap.state_${state}`)}
                          </Text>
                        </View>
                        <Text style={styles.stepSub}>{t(`tutorial.recap.${row.key}S`)}</Text>
                        {row.key === 'shortcut' ? (
                          <View style={styles.shortcutChip}>
                            {/* La vraie icône Raccourcis d'Apple. Elle porte déjà sa
                                forme de carré arrondi et ses coins transparents : on
                                ne lui impose ni rayon ni rognage, qui lui feraient
                                deux arrondis concurrents. */}
                            <Image
                              source={require('../assets/shortcuts-icon.png')}
                              style={styles.shortcutChipIcon}
                            />
                            <Text style={styles.shortcutChipTxt}>{SHORTCUT_NAME}</Text>
                          </View>
                        ) : (
                          <Text style={styles.recapPath}>{t(`tutorial.recap.${row.key}Path`)}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {/* ── Indiquez vos courses ──────────────────────────────────────
                 Sans cette réponse, `rides.status` reste PENDING et l'Historique
                 comme les Stats restent vides — le chauffeur en conclut que le
                 calcul ne marche pas. */}
            {isTag ? (
              <View style={styles.blockList}>
                {TAG_ROWS.map((row, index) => (
                  <View
                    key={row.key}
                    style={[styles.recapRow, index < TAG_ROWS.length - 1 && styles.recapRowDivided]}
                  >
                    {/* Neutres : ces icônes classent des façons de faire, elles ne
                        signalent ni une action à mener ni une réussite. Le vert
                        reste réservé à ces deux-là. */}
                    <MaterialCommunityIcons name={row.icon as any} size={21} color={colors.textMain} />
                    <View style={styles.recapBody}>
                      <Text style={styles.recapTitle}>{t(`tutorial.tag.${row.key}T`)}</Text>
                      <Text style={styles.stepSub}>
                        {row.key === 'notif'
                          ? t(IS_IOS ? 'tutorial.tag.notifS_ios' : 'tutorial.tag.notifS_android')
                          : t(`tutorial.tag.${row.key}S`)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* ── Antisèche ─────────────────────────────────────────────────
                 Quatre gestes et non trois : le quatrième — répondre prise ou
                 refusée — est celui qu'on oublie, et le seul qui remplisse les
                 statistiques. C'est le dernier écran qu'on regarde avant de
                 rouler ; s'il n'y figure pas, il n'existe pas. */}
            {isDone ? (
              <View style={styles.block}>
                {QUICKREF_STEPS.map((n, i) => {
                  const os = IS_IOS ? 'ios' : 'android';
                  return (
                    <LoopStep
                      key={n}
                      n={n}
                      isLast={i === QUICKREF_STEPS.length - 1}
                      title={t(`tutorial.quickRef.${os}.step${n}`)}
                      sub={t(`tutorial.quickRef.${os}.step${n}Sub`)}
                    >

                        {n === 3 ? (
                          <View
                            style={[
                              styles.verdictSlot,
                              previewH > 0 && { height: previewH * PREVIEW_SCALE },
                            ]}
                          >
                            {/* En position absolue : sa hauteur mesurée reste sa
                                hauteur naturelle, que la fente ait déjà été
                                dimensionnée ou non. Sans ça, mesure et hauteur
                                imposée se poursuivraient l'une l'autre. */}
                            <View
                              style={styles.verdictScaler}
                              onLayout={e => setPreviewH(e.nativeEvent.layout.height)}
                            >
                              <ScanPreview />
                            </View>
                          </View>
                        ) : null}
                    </LoopStep>
                  );
                })}
              </View>
            ) : null}
          </Animated.View>
        </ScrollView>
      </View>
    );
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, STEPS.length - 1],
    outputRange: [`${Math.round(100 / STEPS.length)}%`, '100%'],
    extrapolate: 'clamp',
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* Chevron · progression · Passer — la barre de l'onboarding, à
          l'identique, avec « Passer » en plus. Le retour compte ici :
          l'installation renvoie le chauffeur dans les Réglages, et il doit
          pouvoir relire l'étape d'avant sans deviner qu'un swipe existe. */}
      <View style={styles.header}>
        {currentIndex > 0 ? (
          <TouchableOpacity
            onPress={() => goToIndex(currentIndex - 1)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.back', 'Retour')}
          >
            <Feather name="chevron-left" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBackSpacer} />
        )}
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressWidth as any }]} />
        </View>
        <TouchableOpacity
          onPress={closeTutorial}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('tutorial.skip')}
        >
          <Text style={styles.skip}>{t('tutorial.skip')}</Text>
        </TouchableOpacity>
      </View>

      <Animated.FlatList
        ref={flatListRef}
        data={STEPS}
        renderItem={renderStep}
        keyExtractor={item => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        style={styles.flatList}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />

      {/* Pilule pleine largeur, entièrement arrondie, un seul mot : celle de
          l'onboarding. Plus de dégradé ni de flèche dans un rond. */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.footerCta}
          onPress={handleNext}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isLast ? t('tutorial.start') : t('tutorial.next')}
        >
          <Text style={styles.footerCtaTxt}>
            {isLast ? t('tutorial.start') : t('tutorial.next')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const PAD = 26;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // ── En-tête ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 14,
  },
  // Réserve la place du chevron sur la première slide : sans elle, la barre
  // sauterait de 24 px au passage à la deuxième.
  headerBackSpacer: { width: 24 },
  // Épaisse et pleinement arrondie, comme celle de l'onboarding : c'est la même
  // progression, elle doit avoir la même forme.
  progressTrack: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: A,
    borderRadius: 4,
  },
  skip: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Diapositive ────────────────────────────────────────────────────────────
  flatList: { flex: 1 },
  slide: { width, flex: 1 },
  slideScroll: { flex: 1, width: '100%' },
  slideContent: {
    flexGrow: 1,
    // `flex-start` et non `center` : un mode d'emploi commence en haut à gauche
    // et descend. Le centrage vertical faisait flotter les slides courtes et
    // rognait les longues.
    justifyContent: 'flex-start',
    paddingHorizontal: PAD,
    // Constantes partagées avec `computeVideoHeight` : ce sont les marges que la
    // mesure de la fenêtre ne couvre pas.
    paddingTop: SLIDE_PAD_TOP,
    paddingBottom: SLIDE_PAD_BOTTOM,
  },
  slideContentCentered: { justifyContent: 'center', paddingBottom: 64 },
  /// PAGE DE GARDE UNIQUEMENT. L'alignement à gauche est la règle du reste de
  /// l'écran, parce qu'on y exécute des consignes en les lisant. « Bienvenue »
  /// n'en est pas une : ni étape, ni chemin, ni bouton à trouver — juste un nom
  /// et une promesse. Une couverture se compose sur un axe, et c'est aussi ce
  /// que fait l'écran de bienvenue de la référence.
  slideContentAxis: { alignItems: 'center' },
  centerSelf: { alignSelf: 'center' },

  iconLogo: {
    width: 60,
    height: 60,
    borderRadius: 17,
    marginBottom: 22,
  },

  title: {
    color: colors.textMain,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.9,
    lineHeight: 37,
    marginBottom: 12,
    textAlign: 'center',
  },
  desc: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    textAlign: 'center',
  },
  tip: {
    color: colors.textDimmed,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 18,
    textAlign: 'center',
  },

  block: { marginTop: 32 },
  /// Les rangées portent leur propre `paddingVertical` : sans ce retrait, le
  /// premier filet tomberait trop bas et la liste paraîtrait décrochée du titre.
  blockList: { marginTop: 16 },

  // ── Étape numérotée ────────────────────────────────────────────────────────
  // Vert plein, chiffre sombre. Le gris moyen d'un premier essai les faisait
  // fondre dans le fond, le blanc les rendait crus ; l'accent de marque tient
  // les deux bouts. Ce qui garde la page lisible malgré la répétition, c'est que
  // le bouton du pied de page s'efface sur les diapositives qui portent déjà
  // leur propre action (cf. `slideHasOwnCta`) — sans ça, on retomberait sur les
  // aplats d'accent qui se concurrencent.
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: A,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepNumTxt: {
    color: colors.background,
    fontSize: 13,
    fontWeight: '900',
  },
  stepSub: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
  },

  // ── Antisèche : la boucle du quotidien ─────────────────────────────────────
  loopRow: { flexDirection: 'row', gap: 14 },
  loopRail: { alignItems: 'center', width: 26 },
  /// `flex: 1` : le trait prend exactement la hauteur du texte de son étape, donc
  /// il touche toujours la pastille suivante, quel que soit le nombre de lignes.
  loopConnector: {
    flex: 1,
    width: 2,
    minHeight: 12,
    marginVertical: 6,
    borderRadius: 1,
    backgroundColor: HAIRLINE,
  },
  loopTexts: { flex: 1, paddingBottom: 20 },
  loopTextsLast: { paddingBottom: 0 },
  /// Un cran au-dessus des étapes d'installation : c'est le dernier écran qu'on
  /// regarde avant de rouler, et le seul qu'on relira au volant.
  loopTitle: {
    color: colors.textMain,
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 23,
  },

  /// La fente où vit la démonstration. Aucun cadre à elle : `ScanPreview` porte
  /// déjà le sien (l'îlot dynamique), en ajouter un ferait une carte dans une
  /// carte. Léger retrait à droite pour qu'elle ne file pas jusqu'au bord.
  verdictSlot: {
    marginTop: 14,
    marginBottom: 4,
    paddingRight: 4,
  },
  verdictScaler: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    transform: [{ scale: PREVIEW_SCALE }],
    transformOrigin: 'top left',
  },

  // ── Boutons ────────────────────────────────────────────────────────────────
  // Même pilule que l'onboarding : pleine largeur, entièrement arrondie, un
  // libellé centré, aucune icône.
  cta: {
    height: 54,
    borderRadius: 27,
    backgroundColor: A,
    alignItems: 'center',
    justifyContent: 'center',
    // 6 px collaient le bouton à la phrase qui l'explique : on lisait un bloc
    // compact au lieu d'une consigne suivie de son action.
    marginTop: 14,
  },
  ctaTxt: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '800',
  },
  /** Action accomplie et vérifiée : plus rien à faire, le bouton s'éteint. */
  ctaDone: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: A + '55',
  },
  ctaDoneTxt: { color: A },
  /** Action déjà lancée mais non confirmée : reste disponible, sans insister. */
  ctaGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  ctaGhostTxt: { color: colors.textMuted },

  confirmedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  confirmedTxt: {
    color: A,
    fontSize: 14,
    fontWeight: '700',
  },

  // ── Récapitulatif et façons de taguer ──────────────────────────────────────
  recapRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    paddingVertical: 14,
  },
  // Filets entre les rangées : quatre paragraphes séparés par du vide flottaient
  // sans structure. Avec eux, ça se lit comme la liste de contrôle que c'est.
  recapRowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  recapBody: { flex: 1 },
  recapHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  recapTitle: {
    flex: 1,
    color: colors.textMain,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  recapState: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  /// La vignette du raccourci, telle qu'elle apparaît dans l'app Raccourcis.
  /// Le chemin en texte dit où aller ; celle-ci montre CE QU'ON Y CHERCHE — et
  /// c'est plus utile, parce que le doute du chauffeur n'est pas « où est ma
  /// liste » mais « est-ce que le mien y est ». Reprise de RideIQ, qui pose le
  /// même objet à l'écran.
  ///
  /// Le carré coloré évoque l'icône Raccourcis d'Apple sans la copier : on ne
  /// distribue pas l'asset d'un tiers dans un bundle.
  shortcutChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 10,
    marginTop: 10,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  shortcutChipIcon: {
    width: 30,
    height: 30,
  },
  shortcutChipTxt: {
    color: colors.textMain,
    fontSize: 14,
    fontWeight: '800',
  },

  /// Le chemin exact dans les Réglages. Traitement à part — plus petit, plus
  /// sourd — parce qu'on ne le LIT pas : on le suit du doigt, écran en main.
  recapPath: {
    color: colors.textDimmed,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },

  // ── Vidéo AssistiveTouch ───────────────────────────────────────────────────
  // La capture est un écran d'iPhone en portrait. Dans un cadre pleine largeur,
  // `contain` la posait au milieu de deux grosses bandes noires — on voyait une
  // boîte noire avant de voir la démonstration. Le cadre prend donc le format de
  // ce qu'il montre, et se centre.
  // Hauteur d'abord, largeur déduite du format : à 56 % de large la démo faisait
  // 55 % de la page et rejetait sous la ligne de flottaison les étapes 3 et 4
  // ET le bouton « Ouvrir les Réglages », qui est l'action de la diapositive.
  // Elle illustre le geste, elle ne le remplace pas.
  // Hauteur posée par `computeVideoHeight` ; celle-ci n'est que le repli du tout
  // premier rendu, avant que `onLayout` n'ait mesuré quoi que ce soit. La largeur
  // se déduit du format — la capture est un écran d'iPhone en portrait, et dans
  // un cadre pleine largeur `contain` la posait entre deux bandes noires.
  videoFrame: {
    height: height * 0.28,
    aspectRatio: 9 / 19.5,
    alignSelf: 'center',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginBottom: VIDEO_GAP,
  },
  videoPlayer: { width: '100%', height: '100%' },
  videoReplay: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: -10,
    marginBottom: 20,
  },
  videoReplayTxt: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },

  // ── Pied de page ───────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: PAD,
    paddingBottom: 20,
    paddingTop: 8,
  },
  // MEMES MESURES que `cta`, la pilule des étapes : hauteur, rayon, taille de
  // texte. Deux boutons de tailles différentes empilés dans la même colonne se
  // lisaient comme deux composants sans rapport.
  footerCta: {
    height: 54,
    borderRadius: 27,
    backgroundColor: A,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerCtaTxt: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '800',
  },
});

export default TutorialScreen;
