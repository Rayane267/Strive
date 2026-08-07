import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  Animated,
  Platform,
  Linking,
  Switch,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Image } from 'react-native';
import Video from 'react-native-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import SafeGradient from '../components/SafeGradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { hapticLight, hapticSuccess } from '../utils/haptics';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';

const { width, height } = Dimensions.get('window');

// Démo AssistiveTouch (muette, en boucle) affichée dans le slide déclencheur iOS.
const ASSISTIVE_VIDEO = require('../assets/assistivetouch.mov');

// URL iCloud du raccourci pré-construit ("Prendre une capture" + "Analyser
// une course avec Strive"). Si renseignée, le bouton "Obtenir le raccourci"
// l'installe en un tap.
const PREBUILT_SHORTCUT_URL: string | null = 'https://www.icloud.com/shortcuts/d678e4a771654387866c5621e97cc58a';

type IosTrigger = 'backTap' | 'assistive' | 'homeScreen';

// iOS = 6 slides (Welcome + Preview + Install + Trigger + Stats + Done)
// Android = 5 slides (Welcome + Setup + Accept/decline + Stats + Done)
// Accent unique = vert brand sur toutes les slides (palette disciplinée). Les
// couleurs sémantiques rouge/orange/vert vivent uniquement dans le preview verdict.
const A = colors.primary;
const STEPS = (Platform.OS === 'ios'
  ? [
      { key: '1',        icon: 'steering',           color: A, titleKey: 'tutorial.step1.title',         descKey: 'tutorial.step1.desc',         tip: 'tutorial.tips.step1' },
      { key: 'preview',  icon: 'eye-outline',        color: A, titleKey: 'tutorial.iosPreview.title',    descKey: 'tutorial.iosPreview.subtitle', tip: '' },
      { key: 'minimums', icon: 'tune-vertical',      color: A, titleKey: 'tutorial.minimums.title',      descKey: 'tutorial.minimums.desc',       tip: '' },
      { key: '2',        icon: 'download-circle',    color: A, titleKey: 'tutorial.step2_ios.title',     descKey: 'tutorial.step2_ios.desc',     tip: '' },
      // Pas de sous-titre : la question « Comment voulez-vous lancer le
      // raccourci ? » n'a plus lieu d'être depuis que le déclencheur est figé
      // sur AssistiveTouch (cf. iosTrigger ci-dessous).
      // Ni titre ni sous-titre : « Choisissez votre déclencheur » était faux
      // depuis que le déclencheur est figé sur AssistiveTouch, et la vidéo plus
      // les 4 étapes numérotées se suffisent. Ça rend en plus la hauteur qui
      // manquait en bas, où le bouton « Ouvrir les Réglages » mordait sur
      // l'étape « Ajouter Strive ».
      { key: '3',        icon: 'gesture-tap-button', color: A, titleKey: '',                            descKey: '',                            tip: '' },
      { key: 'la_tip',   icon: 'cellphone-nfc',       color: A, titleKey: 'tutorial.laTip.title',         descKey: 'tutorial.laTip.desc',         tip: 'tutorial.tips.laTip' },
      { key: '4',        icon: 'chart-line',         color: A, titleKey: 'tutorial.step4.title',         descKey: 'tutorial.step4.desc',         tip: 'tutorial.tips.step4' },
      { key: '5',        icon: 'rocket-launch',      color: A, titleKey: 'tutorial.step5_ios.title',     descKey: 'tutorial.step5_ios.desc',     tip: 'tutorial.tips.step5_ios' },
    ]
  : [
      { key: '1',        icon: 'steering',       color: A, titleKey: 'tutorial.step1.title',      descKey: 'tutorial.step1.desc',      tip: 'tutorial.tips.step1' },
      { key: 'preview',  icon: 'eye-outline',    color: A, titleKey: 'tutorial.iosPreview.title', descKey: 'tutorial.iosPreview.subtitle', tip: '' },
      { key: 'minimums', icon: 'tune-vertical',  color: A, titleKey: 'tutorial.minimums.title',   descKey: 'tutorial.minimums.desc',   tip: '' },
      { key: '2',        icon: 'line-scan',      color: A, titleKey: 'tutorial.step2.title',      descKey: 'tutorial.step2.desc',      tip: 'tutorial.tips.step2' },
      { key: '4',        icon: 'chart-line',     color: A, titleKey: 'tutorial.step4.title',      descKey: 'tutorial.step4.desc',      tip: 'tutorial.tips.step4' },
      { key: '5',        icon: 'rocket-launch',  color: A, titleKey: 'tutorial.step5.title',      descKey: 'tutorial.step5.desc',      tip: 'tutorial.tips.step5' },
    ]
) as readonly { key: string; icon: string; color: string; titleKey: string; descKey: string; tip: string }[];

// Le preset `casual` DOIT rester égal à FREE_THRESHOLDS : c'est le réglage
// réellement appliqué aux comptes gratuits. Avant, le tuto proposait 20 €/h et
// 0,80 €/km pendant que l'app jugeait à 25 / 1,20 — le chauffeur choisissait un
// réglage sans effet, sous les valeurs réellement utilisées.
const PRESETS = [
  { key: 'casual', hourly: 25, km: 1.10 },
  { key: 'standard', hourly: 32, km: 1.35 },
  { key: 'premium', hourly: 42, km: 1.70 },
];

const PREVIEW_DATA = [
  { hourly: 53, fare: 17, km: '3.15', duration: 28, distance: '5.4', color: '#00C752', icon: 'check' as const, verdictKey: 'tutorial.iosPreview.verdictTake', hintKey: 'tutorial.iosPreview.hintGood' },
  { hourly: 38, fare: 7,  km: '3.50', duration: 9,  distance: '2.0', color: '#FF9900', icon: 'alert-triangle' as const, verdictKey: 'tutorial.iosPreview.verdictMaybe', hintKey: 'tutorial.iosPreview.hintAverage' },
  { hourly: 15, fare: 22, km: '0.78', duration: 42, distance: '10.3', color: '#F04444', icon: 'x' as const, verdictKey: 'tutorial.iosPreview.verdictSkip', hintKey: 'tutorial.iosPreview.hintBad' },
];

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
  // iOS : un seul déclencheur supporté — AssistiveTouch. (Le choix Back Tap /
  // Écran d'accueil a été retiré du tuto.) Type large conservé pour les
  // branches d'aide existantes.
  const iosTrigger = 'assistive' as IosTrigger;
  const [shortcutInstalled, setShortcutInstalled] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [minHourly, setMinHourly] = useState(30);
  const [minKm, setMinKm] = useState(1.0);
  const [includePickup, setIncludePickup] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<string | null>('standard');

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

  const savePreferences = async () => {
    if (!user?.id) return;
    try {
      // On laisse l'utilisateur RÉGLER les seuils dans le tuto (il découvre qu'on
      // peut personnaliser → désir de Plus), mais on ne les ENREGISTRE pas : en
      // free les seuils sont imposés (FREE_THRESHOLDS). La personnalisation réelle
      // est un avantage Plus.
      // Seul `include_pickup` (non gated) est persisté.
      await supabase.from('preferences').upsert({
        id: user.id,
        include_pickup: includePickup,
      });
    } catch {}
  };

  const handleNext = () => {
    if (!isLast) {
      goToIndex(currentIndex + 1);
    } else {
      hapticSuccess();
      savePreferences();
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

  const installShortcut = () => {
    if (PREBUILT_SHORTCUT_URL) {
      Linking.openURL(PREBUILT_SHORTCUT_URL)
        .then(() => setShortcutInstalled(true))
        .catch(() => Linking.openURL('shortcuts://'));
      return;
    }
    Linking.openURL('shortcuts://').catch(() => Linking.openSettings());
    setShortcutInstalled(true);
  };

  // Le CTA primaire du Choose Trigger :
  // - AssistiveTouch / Back Tap → Réglages (fiche de l'app)
  // - Écran d'accueil → app Raccourcis (pour épingler le raccourci)
  //
  // `App-prefs:` ouvrait autrefois directement Réglages → Accessibilité, mais
  // c'est un schéma d'URL privé : sans effet sur les iOS récents, et motif de
  // rejet en revue (règle 2.5.1). `openSettings()` est la seule API publique —
  // elle ouvre la fiche Réglages de Strive, les étapes numérotées de la slide
  // donnent le chemin à partir de là. Le libellé promet donc « les Réglages »
  // et pas « les réglages d'accessibilité », qu'on ne sait pas atteindre.
  const triggerPrimaryAction = () => {
    if (iosTrigger === 'homeScreen') {
      Linking.openURL('shortcuts://').catch(() => Linking.openSettings());
      return;
    }
    Linking.openSettings();
  };
  const triggerPrimaryLabel = () =>
    iosTrigger === 'homeScreen'
      ? t('tutorial.openShortcuts', 'Ouvrir Raccourcis')
      : t('tutorial.iosTrigger.ctaSettings', 'Ouvrir les Réglages');

  const restartVideo = () => {
    hapticLight();
    videoRef.current?.seek(0);
  };

  const renderStep = ({ item, index }: { item: typeof STEPS[number]; index: number }) => {
    const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
    const scale = scrollX.interpolate({ inputRange, outputRange: [0.7, 1, 0.7], extrapolate: 'clamp' });
    const opacity = scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
    const translateY = scrollX.interpolate({ inputRange, outputRange: [30, 0, 30], extrapolate: 'clamp' });

    const tipText = t(item.tip, { defaultValue: '' });
    const isIosPreview = Platform.OS === 'ios' && item.key === 'preview';
    const isIosInstall = Platform.OS === 'ios' && item.key === '2';
    const isIosTrigger = Platform.OS === 'ios' && item.key === '3';
    const isMinimums = item.key === 'minimums';
    const isDone = item.key === '5';
    const hasCustomBlock = isIosPreview || isIosInstall || isIosTrigger || isMinimums || isDone;
    // Slide déclencheur : la vidéo AssistiveTouch EST le visuel — pas d'icône en
    // plus, sinon le contenu dépasse la hauteur d'écran (page rognée).
    const showCompactIcon = hasCustomBlock && !isDone && !isIosTrigger;
    // Slides sans visuel d'en-tête du tout. `showCompactIcon` seul ne suffisait
    // pas : à false, le ternaire retombait sur la branche par défaut et rendait
    // l'icône 96 px + le badge « STEP » (~174 px), soit précisément le
    // dépassement que le commentaire ci-dessus dit vouloir éviter.
    const hideHeaderVisual = isDone || isIosTrigger;

    return (
      <View style={styles.slide}>
        {/* Halo de fond unique, très discret */}
        <View style={styles.glowCircle} />

        <Animated.View style={{ alignItems: 'center', opacity, transform: [{ scale }, { translateY }] }}>
          {showCompactIcon ? (
            <SafeGradient
              colors={[item.color + '25', item.color + '08']}
              style={styles.iconCompact}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <MaterialCommunityIcons name={item.icon as any} size={26} color={item.color} />
            </SafeGradient>
          ) : hideHeaderVisual ? null : (
            <>
              <View style={styles.iconContainer}>
                {item.key === '1' ? (
                  <Image
                    source={require('../assets/strive-logo.png')}
                    style={styles.iconLogoImg}
                  />
                ) : (
                  <SafeGradient
                    colors={[item.color + '22', item.color + '0A']}
                    style={styles.iconWrap}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <MaterialCommunityIcons name={item.icon as any} size={46} color={item.color} />
                  </SafeGradient>
                )}
              </View>

              {/* Step badge */}
              <View style={[styles.stepBadge, { backgroundColor: item.color + '18' }]}>
                <Text style={[styles.stepBadgeText, { color: item.color }]}>
                  {t('tutorial.step', { defaultValue: 'STEP' })} {index + 1}
                </Text>
              </View>
            </>
          )}

          {/* titleKey vide = slide sans titre (déclencheur AssistiveTouch) : on ne
              rend pas un Text vide, qui laisserait sa marge basse. Même logique
              que descKey ci-dessous. */}
          {item.titleKey ? (
            <Text style={[styles.stepTitle, hasCustomBlock && styles.stepTitleCompact]}>{t(item.titleKey)}</Text>
          ) : null}
          {/* descKey vide = slide sans sous-titre (ex. Choisir le déclencheur,
              où la vidéo et les étapes numérotées se suffisent) : on ne rend pas
              un Text vide, qui laisserait sa marge basse. */}
          {item.descKey ? (
            <Text style={[styles.stepDesc, hasCustomBlock && styles.stepDescCompact]}>{t(item.descKey)}</Text>
          ) : null}

          {/* Interactive tip card — masquée sur les slides iOS custom (déjà denses) */}
          {tipText && !hasCustomBlock ? (
            <Animated.View style={[styles.tipCard, { opacity }]}>
              <View style={[styles.tipIcon, { backgroundColor: item.color + '15' }]}>
                <Feather name="zap" size={14} color={item.color} />
              </View>
              <Text style={styles.tipText}>{tipText}</Text>
            </Animated.View>
          ) : null}

          {/* Slide iOS 2 — Install Shortcut (single-line steps like ref) */}
          {isIosInstall ? (
            <Animated.View style={[styles.iosInstallBlock, { opacity }]}>
              <View style={styles.installStepsCard}>
                {[1, 2, 3].map(n => (
                  <View key={n} style={styles.installStepRow}>
                    <View style={[styles.installStepNum, { backgroundColor: item.color }]}>
                      <Text style={styles.installStepNumTxt}>{n}</Text>
                    </View>
                    <Text style={styles.installStepTxt}>{t(`tutorial.iosInstall.step${n}t`)}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.installWarning}>
                <MaterialCommunityIcons name="alert" size={13} color="#FFB300" />
                {'  '}{t('tutorial.iosInstall.warning')}
              </Text>

              <TouchableOpacity
                style={[
                  styles.iosBigCta,
                  { backgroundColor: shortcutInstalled ? 'rgba(0,230,118,0.14)' : item.color },
                  shortcutInstalled && { borderWidth: 1, borderColor: item.color + '80' },
                ]}
                onPress={installShortcut}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons
                  name={shortcutInstalled ? 'check-circle' : 'download'}
                  size={18}
                  color={shortcutInstalled ? item.color : colors.background}
                />
                <Text style={[styles.iosBigCtaTxt, shortcutInstalled && { color: item.color }]}>
                  {shortcutInstalled
                    ? t('tutorial.iosInstall.ctaDone', 'Raccourci installé — rouvrir')
                    : t('tutorial.iosInstall.cta')}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          ) : null}

          {/* Slide iOS « See It In Action » — tap to cycle through 3 examples */}
          {isIosPreview ? (
            <Animated.View style={[styles.iosPreviewBlock, { opacity }]}>
              {(() => {
                const p = PREVIEW_DATA[previewIdx];
                return (
                  <>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => { hapticLight(); setPreviewIdx((previewIdx + 1) % PREVIEW_DATA.length); }}
                    >
                      <View style={styles.dynamicIsland}>
                        <View style={styles.diRowTop}>
                          <Text style={styles.diPlatform}>Uber</Text>
                          <View style={styles.diHourly}>
                            <Text style={styles.diHourlyValue}>€{p.hourly}</Text>
                            <Text style={styles.diHourlyUnit}>/h</Text>
                          </View>
                          <View style={{ flex: 1 }} />
                          <View style={[styles.diFarePill, { backgroundColor: p.color + '46', borderColor: p.color + 'D9' }]}>
                            <Text style={styles.diFarePillTxt}>€{p.fare}</Text>
                          </View>
                          <View style={styles.diKmRate}>
                            <Feather name="arrow-up-right" size={11} color={p.color} />
                            <Text style={styles.diKmRateTxt}>€{p.km}/km</Text>
                          </View>
                        </View>
                        <View style={styles.diRouteRow}>
                          <View style={[styles.diRouteCircle, { backgroundColor: p.color }]}>
                            <MaterialCommunityIcons name="car" size={12} color="#000" />
                          </View>
                          <View style={styles.diRouteLineWrap}>
                            <View style={[styles.diRouteLine, { backgroundColor: p.color + 'D9' }]} />
                            <View style={[styles.diRouteDot, { backgroundColor: p.color }]} />
                          </View>
                          <View style={styles.diRouteStats}>
                            <Text style={styles.diRouteDuration}>{p.duration}min</Text>
                            <Text style={styles.diRouteDistance}>{p.distance}km</Text>
                          </View>
                          <View style={[styles.diRouteCircle, { backgroundColor: p.color }]}>
                            <Feather name={p.icon} size={12} color="#000" />
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>

                    <View style={styles.previewVerdict}>
                      <View style={[styles.previewVerdictDot, { backgroundColor: p.color }]} />
                      <Text style={[styles.previewVerdictTxt, { color: p.color }]}>
                        {t(p.verdictKey)}
                      </Text>
                    </View>

                    <Text style={styles.previewHintTxt}>{t(p.hintKey)}</Text>

                    <View style={styles.previewDots}>
                      {PREVIEW_DATA.map((d, pi) => (
                        <TouchableOpacity key={pi} onPress={() => { hapticLight(); setPreviewIdx(pi); }}>
                          <View style={[styles.previewDot, pi === previewIdx && { backgroundColor: d.color, width: 24 }]} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                );
              })()}
            </Animated.View>
          ) : null}

          {/* Slide Minimums — seuils €/h, €/km, pickup */}
          {isMinimums ? (
            <Animated.View style={[styles.iosPreviewBlock, { opacity }]}>
              <View style={styles.presetRow}>
                {PRESETS.map(p => {
                  const active = selectedPreset === p.key;
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[styles.presetCard, active && styles.presetCardActive]}
                      onPress={() => { hapticLight(); setSelectedPreset(p.key); setMinHourly(p.hourly); setMinKm(p.km); }}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.presetName, active && styles.presetNameActive]}>{t(`tutorial.minimums.${p.key}`)}</Text>
                      <Text style={[styles.presetValue, active && styles.presetValueActive]}>€{p.hourly}/h</Text>
                      <Text style={[styles.presetSub, active && styles.presetSubActive]}>€{p.km.toFixed(2)}/km</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.presetHint}>{t('tutorial.minimums.presetHint')}</Text>

              <View style={styles.sliderBlock}>
                <View style={styles.sliderHeader}>
                  <Text style={styles.sliderLabel}>{t('tutorial.minimums.hourly')}</Text>
                  <Text style={styles.sliderValue}>€{minHourly}/h</Text>
                </View>
                <Slider
                  style={styles.slider}
                  minimumValue={10} maximumValue={80} step={1}
                  value={minHourly}
                  onValueChange={v => { setMinHourly(v); setSelectedPreset(null); }}
                  minimumTrackTintColor={colors.primary}
                  maximumTrackTintColor="rgba(255,255,255,0.08)"
                  thumbTintColor={colors.primary}
                />
                <Text style={styles.sliderHint}>{t('tutorial.minimums.hourlyHint')}</Text>
              </View>

              <View style={styles.sliderBlock}>
                <View style={styles.sliderHeader}>
                  <Text style={styles.sliderLabel}>{t('tutorial.minimums.kmRate')}</Text>
                  <Text style={styles.sliderValue}>€{minKm.toFixed(2)}/km</Text>
                </View>
                <Slider
                  style={styles.slider}
                  minimumValue={0.3} maximumValue={4} step={0.05}
                  value={minKm}
                  onValueChange={v => { setMinKm(v); setSelectedPreset(null); }}
                  minimumTrackTintColor={colors.primary}
                  maximumTrackTintColor="rgba(255,255,255,0.08)"
                  thumbTintColor={colors.primary}
                />
                <Text style={styles.sliderHint}>{t('tutorial.minimums.kmRateHint')}</Text>
              </View>

              <View style={styles.pickupRow}>
                <Text style={styles.pickupLabel}>{t('tutorial.minimums.includePickup')}</Text>
                <Switch
                  value={includePickup}
                  onValueChange={setIncludePickup}
                  trackColor={{ false: 'rgba(255,255,255,0.08)', true: colors.primary + '60' }}
                  thumbColor={includePickup ? colors.primary : '#ccc'}
                />
              </View>
            </Animated.View>
          ) : null}

          {/* Dernière slide = antisèche du premier scan, pas une célébration.
              La coche verte, la puce « tout est prêt » et l'intertitre
              « COMMENT ÇA MARCHE » ont été retirés : ils répétaient le titre
              (« tout est prêt » y figurait trois fois) et repoussaient hors
              écran la seule chose utile ici — les trois gestes. */}
          {isDone ? (
            <Animated.View style={[styles.doneBlock, { opacity }]}>
              <View style={styles.qrCard}>
                {(Platform.OS === 'android' ? [
                  // La couleur porte le sens : les deux gestes restent neutres,
                  // seul le verdict prend le vert brand — l'oeil tombe sur la
                  // recompense. Conforme a la regle de palette en tete de fichier.
                  { icon: 'line-scan', color: colors.textMuted, labelKey: 'tutorial.quickRef.android.step1', subKey: 'tutorial.quickRef.android.step1Sub' },
                  { icon: 'gesture-tap', color: colors.textMuted, labelKey: 'tutorial.quickRef.android.step2', subKey: 'tutorial.quickRef.android.step2Sub' },
                  { icon: 'check-decagram', color: colors.primary, labelKey: 'tutorial.quickRef.android.step3', subKey: 'tutorial.quickRef.android.step3Sub' },
                ] : [
                  { icon: 'cellphone-screenshot', color: colors.textMuted, labelKey: 'tutorial.quickRef.ios.step1', subKey: 'tutorial.quickRef.ios.step1Sub' },
                  { icon: 'gesture-tap-hold', color: colors.textMuted, labelKey: 'tutorial.quickRef.ios.step2', subKey: 'tutorial.quickRef.ios.step2Sub' },
                  { icon: 'check-decagram', color: colors.primary, labelKey: 'tutorial.quickRef.ios.step3', subKey: 'tutorial.quickRef.ios.step3Sub' },
                ]).map((step, i, arr) => (
                  <View key={i} style={styles.qrStepRow}>
                    <View style={styles.qrRail}>
                      <View style={[styles.qrIcon, { backgroundColor: step.color + '18', borderColor: step.color + '40' }]}>
                        <MaterialCommunityIcons name={step.icon as any} size={22} color={step.color} />
                      </View>
                      {i < arr.length - 1 && <View style={styles.qrConnector} />}
                    </View>
                    <View style={[styles.qrStepTexts, i === arr.length - 1 && { paddingBottom: 0 }]}>
                      <View style={styles.qrStepTitleRow}>
                        <Text style={[styles.qrStepNum, { color: step.color }]}>{i + 1}</Text>
                        <Text style={styles.qrLabel}>{t(step.labelKey)}</Text>
                      </View>
                      <Text style={styles.qrSub}>{t(step.subKey)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </Animated.View>
          ) : null}

          {/* Slide iOS 3 — Choose Trigger (inspired by Trip Identifier) */}
          {isIosTrigger ? (
            <Animated.View style={[styles.iosTriggerBlock, { opacity }]}>
              <View style={styles.iosTriggerContent}>
                <View style={styles.videoPhoneFrame}>
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
                  <TouchableOpacity
                    style={styles.videoReplayBtn}
                    onPress={restartVideo}
                    activeOpacity={0.85}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('tutorial.restartVideo', 'Revoir la vidéo')}
                  >
                    <Feather name="rotate-ccw" size={13} color="#fff" />
                    <Text style={styles.videoReplayTxt}>{t('tutorial.restartVideo', 'Revoir la vidéo')}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.triggerHeroLabel}>{t(`tutorial.iosTrigger.${iosTrigger}.hero`)}</Text>

                <View style={styles.triggerStepsList}>
                  {[1, 2, 3, 4].map(n => {
                    const titleKey = `tutorial.iosTrigger.${iosTrigger}.step${n}t`;
                    const subKey = `tutorial.iosTrigger.${iosTrigger}.step${n}s`;
                    const title = t(titleKey, { defaultValue: '' });
                    if (!title) return null;
                    return (
                      <View key={n} style={styles.triggerStepRow}>
                        <View style={[styles.triggerStepNum, { backgroundColor: item.color + '15', borderColor: item.color + '40' }]}>
                          <Text style={[styles.triggerStepNumTxt, { color: item.color }]}>{n}</Text>
                        </View>
                        <View style={styles.triggerStepTexts}>
                          <Text style={styles.triggerStepTitle}>{title}</Text>
                          <Text style={styles.triggerStepSub}>{t(subKey)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>

              <TouchableOpacity
                style={[styles.iosBigCta, { backgroundColor: item.color }]}
                onPress={triggerPrimaryAction}
                activeOpacity={0.85}
              >
                <Feather name={iosTrigger === 'homeScreen' ? 'external-link' : 'settings'} size={17} color={colors.background} />
                <Text style={styles.iosBigCtaTxt}>{triggerPrimaryLabel()}</Text>
              </TouchableOpacity>
            </Animated.View>
          ) : null}
        </Animated.View>
      </View>
    );
  };

  // Progress bar width animation
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, STEPS.length - 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.progressBarTrack}>
          <Animated.View style={[styles.progressBarFill, { width: progressWidth as any }]} />
        </View>
        <TouchableOpacity onPress={() => { savePreferences(); closeTutorial(); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel={t('tutorial.skip')}>
          <Text style={styles.skipText}>{t('tutorial.skip')}</Text>
        </TouchableOpacity>
      </View>

      {/* Slides — swipe enabled */}
      <Animated.FlatList
        ref={flatListRef}
        data={STEPS}
        renderItem={renderStep}
        keyExtractor={item => item.key}
        horizontal
        pagingEnabled
        scrollEnabled={true}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        style={styles.flatList}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />

      {/* Footer */}
      <View style={styles.footer}>
        {/* Progress dots */}
        <View style={styles.dotsRow}>
          {STEPS.map((step, i) => {
            const isActive = i === currentIndex;
            const isPast = i < currentIndex;
            return (
              <TouchableOpacity key={i} onPress={() => goToIndex(i)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
                <Animated.View
                  style={[
                    styles.dot,
                    isPast && { backgroundColor: STEPS[currentIndex].color + '50' },
                    isActive && [styles.dotActive, { backgroundColor: STEPS[currentIndex].color }],
                  ]}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Step counter */}
        <Text style={styles.stepCounter}>
          {currentIndex + 1} / {STEPS.length}
        </Text>

        {/* Navigation button */}
        <TouchableOpacity
          style={styles.nextBtn}
          onPress={handleNext}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isLast ? t('tutorial.start') : t('tutorial.next')}
        >
          <SafeGradient
            colors={isLast ? [colors.primary, '#00C864'] : [colors.surface, colors.surfaceLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.nextBtnGradient}
          >
            <Text style={[styles.nextBtnText, isLast && styles.nextBtnTextFinal]}>
              {isLast ? t('tutorial.start') : t('tutorial.next')}
            </Text>
            <View style={[styles.nextBtnIcon, isLast && { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <Feather
                name={isLast ? 'check' : 'arrow-right'}
                size={16}
                color={isLast ? '#fff' : colors.textMuted}
              />
            </View>
          </SafeGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 16,
  },
  progressBarTrack: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  skipText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  flatList: { flex: 1 },

  slide: {
    width,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 40,
  },

  glowCircle: {
    position: 'absolute',
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    top: height * 0.04,
    backgroundColor: colors.primary + '07',
  },

  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  iconLogoImg: {
    width: 96,
    height: 96,
    borderRadius: 26,
  },

  stepBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  stepBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },

  stepTitle: {
    color: colors.textMain,
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  stepTitleCompact: {
    fontSize: 22,
    lineHeight: 28,
    marginBottom: 8,
  },
  stepDesc: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
  },
  stepDescCompact: {
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 320,
    marginBottom: 4,
  },
  iconCompact: {
    width: 60,
    height: 60,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },

  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: 300,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tipIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },

  // ── iOS slides — common ──
  iosInstallBlock: {
    width: '100%',
    marginTop: 18,
    alignItems: 'stretch',
  },
  iosTriggerBlock: {
    width: '100%',
    marginTop: 10,
    alignItems: 'stretch',
  },
  iosPreviewBlock: {
    width: '100%',
    marginTop: 14,
    alignItems: 'stretch',
  },

  iosBigCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 52,
    borderRadius: 16,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  iosBigCtaTxt: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  iosSecondaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginTop: 4,
  },
  iosSecondaryTxt: {
    fontSize: 13,
    fontWeight: '700',
  },

  // (old step styles removed — now using triggerStep* pattern)

  // ── Install hero card ──
  iosHeroCard: {
    height: 96,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  iosHeroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Trigger : iOS segmented control ──
  iosSegmented: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 18,
  },
  iosSegment: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosSegmentActive: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  iosSegmentTxt: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  iosSegmentTxtActive: {
    color: colors.textMain,
    fontWeight: '700',
  },

  // ── Trigger hero illustrative card ──
  iosTriggerHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.025)',
    marginBottom: 20,
  },
  iosTriggerHeroIcon: {
    width: 58,
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosTriggerHeroTxt: {
    flex: 1,
    color: colors.textMain,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },

  // ── Preview : Lock screen frame + Live Activity mock (match Swift) ──
  iosLockFrame: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 18,
  },
  iosLockTime: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 12,
  },
  // Mock 1:1 du SwiftUI StriveLiveActivity.LockScreenView
  dynamicIsland: {
    width: '100%',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(0,0,0,0.92)',
    gap: 16,
  },
  diRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  diPlatform: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
    fontWeight: '600',
  },
  diHourly: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  diHourlyValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  diHourlyUnit: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: '600',
  },
  diFarePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  diFarePillTxt: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  diKmRate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  diKmRateTxt: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  diRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  diRouteCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diRouteLineWrap: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diRouteLine: {
    height: 4,
    width: '100%',
    borderRadius: 2,
  },
  diRouteDot: {
    position: 'absolute',
    width: 11,
    height: 11,
    borderRadius: 5.5,
  },
  diRouteStats: {
    alignItems: 'flex-end',
    minWidth: 50,
  },
  diRouteDuration: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  diRouteDistance: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 13,
  },
  iosPreviewHint: {
    color: colors.textDimmed,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 17,
  },

  // Preview verdict + hint
  previewVerdict: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    marginBottom: 6,
  },
  previewVerdictDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  previewVerdictTxt: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  previewHintTxt: {
    color: colors.textDimmed,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 17,
  },
  previewDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 4,
  },
  previewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  // Minimums presets
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  presetCard: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
  },
  presetCardActive: {
    backgroundColor: colors.primary + '1A',
    borderColor: colors.primary + '66',
  },
  presetName: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  presetNameActive: { color: colors.primary },
  presetValue: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '900',
  },
  presetValueActive: { color: colors.primary },
  presetSub: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  presetSubActive: { color: colors.primary + 'AA' },
  presetHint: {
    color: colors.textDimmed,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 16,
  },

  // Sliders
  sliderBlock: {
    marginBottom: 14,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sliderLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  sliderValue: {
    color: colors.textMain,
    fontSize: 14,
    fontWeight: '800',
  },
  slider: {
    width: '100%',
    height: 36,
  },
  sliderHint: {
    color: colors.textDimmed,
    fontSize: 11,
    lineHeight: 16,
    marginTop: -2,
  },

  // Pickup toggle
  pickupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  pickupLabel: {
    color: colors.textMain,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },

  // Trigger content
  iosTriggerContent: {
    alignItems: 'center',
  },
  triggerRecommended: {
    color: '#FFB300',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: 0.3,
  },
  // Démo AssistiveTouch — cadre "téléphone" portrait autour de la vidéo.
  // Compact (124 pt) pour que vidéo + 4 étapes + CTA tiennent sans rognage.
  videoPhoneFrame: {
    // Hauteur proportionnelle à l'écran (largeur déduite par l'aspectRatio) :
    // en dur à 124 × 248, la vidéo + les 4 étapes + le CTA dépassaient la slide
    // sur les petits écrans et le bouton sortait du cadre. Plafonné pour ne pas
    // devenir énorme sur les grands modèles.
    height: Math.min(226, height * 0.26),
    aspectRatio: 9 / 18,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.14)',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  videoPlayer: {
    ...StyleSheet.absoluteFillObject,
  },
  videoReplayBtn: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  videoReplayTxt: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  triggerHeroLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  triggerStepsList: {
    width: '100%',
    gap: 8,
    marginBottom: 12,
  },
  triggerStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  triggerStepNum: {
    width: 32,
    height: 32,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerStepNumTxt: {
    fontSize: 13,
    fontWeight: '800',
  },
  triggerStepTexts: {
    flex: 1,
    gap: 1,
  },
  triggerStepTitle: {
    color: colors.textMain,
    fontSize: 14,
    fontWeight: '700',
  },
  triggerStepSub: {
    color: colors.textDimmed,
    fontSize: 12,
    fontWeight: '500',
  },

  // Done step
  doneBlock: {
    width: width - 48,
    alignItems: 'center',
    marginTop: 8,
  },
  doneSubtitle: {
    color: colors.textDimmed,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 16,
  },

  // Install shortcut — single-line steps in a card
  installStepsCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 16,
    gap: 16,
    marginBottom: 16,
  },
  installStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  installStepNum: {
    width: 30,
    height: 30,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  installStepNumTxt: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  installStepTxt: {
    flex: 1,
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '500',
  },
  installWarning: {
    color: '#FFB300',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
  },

  // Quick Reference — horizontal card (done step)
  qrCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    // Respire un peu plus depuis la suppression de l'intertitre.
    paddingVertical: 26,
    paddingHorizontal: 20,
  },
  qrStepRow: {
    flexDirection: 'row',
    gap: 14,
  },
  qrRail: {
    alignItems: 'center',
    width: 44,
  },
  qrIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  qrConnector: {
    flex: 1,
    width: 2,
    minHeight: 14,
    marginVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 1,
  },
  qrStepTexts: {
    flex: 1,
    paddingTop: 3,
    paddingBottom: 16,
  },
  qrStepTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  qrStepNum: {
    fontSize: 13,
    fontWeight: '900',
  },
  qrLabel: {
    color: colors.textMain,
    fontSize: 16,
    fontWeight: '800',
  },
  qrSub: {
    // textMuted plutot que textDimmed : cette antiseche se lit d'un coup d'oeil,
    // souvent au volant. On prend le contraste le plus haut des deux gris.
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },

  footer: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 16,
    alignItems: 'center',
  },

  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  dotActive: {
    width: 28,
    height: 8,
    borderRadius: 4,
  },

  stepCounter: {
    color: colors.textDimmed,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  nextBtn: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  nextBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 58,
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  nextBtnText: {
    color: colors.textMain,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  nextBtnTextFinal: {
    color: '#fff',
  },
  nextBtnIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default TutorialScreen;
