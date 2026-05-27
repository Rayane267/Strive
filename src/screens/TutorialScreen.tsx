import React, { useRef, useState, useCallback } from 'react';
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

// Suffixe iOS uniquement sur les étapes où le flow diffère (scanner + lancement).
// Les écrans bienvenue / analytics restent identiques aux deux plateformes.
const SUFFIX = Platform.OS === 'ios' ? '_ios' : '';

// URL iCloud du raccourci pré-construit ("Prendre une capture" + "Analyser
// une course avec Strive"). Si renseignée, le bouton "Obtenir le raccourci"
// l'installe en un tap.
const PREBUILT_SHORTCUT_URL: string | null = 'https://www.icloud.com/shortcuts/d678e4a771654387866c5621e97cc58a';

type IosTrigger = 'backTap' | 'assistive' | 'homeScreen';

// iOS = 6 slides (Welcome + Preview + Install + Trigger + Stats + Done)
// Android = 5 slides (Welcome + Setup + Accept/decline + Stats + Done)
const STEPS = (Platform.OS === 'ios'
  ? [
      { key: '1',        icon: 'steering',           color: colors.primary, titleKey: 'tutorial.step1.title',         descKey: 'tutorial.step1.desc',         tip: 'tutorial.tips.step1' },
      { key: 'preview',  icon: 'eye-outline',        color: '#A78BFA',      titleKey: 'tutorial.iosPreview.title',    descKey: 'tutorial.iosPreview.subtitle', tip: '' },
      { key: 'minimums', icon: 'tune-vertical',      color: '#FF8A65',      titleKey: 'tutorial.minimums.title',      descKey: 'tutorial.minimums.desc',       tip: '' },
      { key: '2',        icon: 'download-circle',    color: '#4FC3F7',      titleKey: 'tutorial.step2_ios.title',     descKey: 'tutorial.step2_ios.desc',     tip: '' },
      { key: '3',        icon: 'gesture-tap-button', color: colors.primary, titleKey: 'tutorial.step3_ios.title',     descKey: 'tutorial.step3_ios.desc',     tip: '' },
      { key: 'la_tip',   icon: 'cellphone-nfc',       color: '#F44336',      titleKey: 'tutorial.laTip.title',         descKey: 'tutorial.laTip.desc',         tip: 'tutorial.tips.laTip' },
      { key: '4',        icon: 'chart-line',         color: '#FF8A65',      titleKey: 'tutorial.step4.title',         descKey: 'tutorial.step4.desc',         tip: 'tutorial.tips.step4' },
      { key: '5',        icon: 'rocket-launch',      color: colors.primary, titleKey: 'tutorial.step5_ios.title',     descKey: 'tutorial.step5_ios.desc',     tip: 'tutorial.tips.step5_ios' },
    ]
  : [
      { key: '1',        icon: 'steering',       color: colors.primary, titleKey: 'tutorial.step1.title',      descKey: 'tutorial.step1.desc',      tip: 'tutorial.tips.step1' },
      { key: 'preview',  icon: 'eye-outline',    color: '#A78BFA',      titleKey: 'tutorial.iosPreview.title', descKey: 'tutorial.iosPreview.subtitle', tip: '' },
      { key: 'minimums', icon: 'tune-vertical',  color: '#FF8A65',      titleKey: 'tutorial.minimums.title',   descKey: 'tutorial.minimums.desc',   tip: '' },
      { key: '2',        icon: 'line-scan',      color: '#4FC3F7',      titleKey: 'tutorial.step2.title',      descKey: 'tutorial.step2.desc',      tip: 'tutorial.tips.step2' },
      { key: '4',        icon: 'chart-line',     color: '#FF8A65',      titleKey: 'tutorial.step4.title',      descKey: 'tutorial.step4.desc',      tip: 'tutorial.tips.step4' },
      { key: '5',        icon: 'rocket-launch',  color: colors.primary, titleKey: 'tutorial.step5.title',      descKey: 'tutorial.step5.desc',      tip: 'tutorial.tips.step5' },
    ]
) as readonly { key: string; icon: string; color: string; titleKey: string; descKey: string; tip: string }[];

const PREVIEW_DATA = [
  { hourly: 53, fare: 17, km: '3.15', duration: 28, distance: '5.4', color: '#00C752', icon: 'check' as const, verdictKey: 'tutorial.iosPreview.verdictTake', hintKey: 'tutorial.iosPreview.hintGood' },
  { hourly: 38, fare: 7,  km: '3.50', duration: 9,  distance: '2.0', color: '#FF9900', icon: 'alert-triangle' as const, verdictKey: 'tutorial.iosPreview.verdictMaybe', hintKey: 'tutorial.iosPreview.hintAverage' },
  { hourly: 15, fare: 22, km: '0.78', duration: 42, distance: '10.3', color: '#F04444', icon: 'x' as const, verdictKey: 'tutorial.iosPreview.verdictSkip', hintKey: 'tutorial.iosPreview.hintBad' },
];

const PRESETS = [
  { key: 'casual', hourly: 20, km: 0.80 },
  { key: 'standard', hourly: 30, km: 1.0 },
  { key: 'premium', hourly: 40, km: 1.50 },
];

const TutorialScreen = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [currentIndex, setCurrentIndex] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [iosTrigger, setIosTrigger] = useState<IosTrigger>('assistive');
  const [shortcutInstalled, setShortcutInstalled] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [minHourly, setMinHourly] = useState(30);
  const [minKm, setMinKm] = useState(1.0);
  const [includePickup, setIncludePickup] = useState(false);
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
      await supabase.from('preferences').upsert({
        id: user.id,
        min_hourly_rate: minHourly,
        min_km_rate: minKm,
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
      navigation.goBack();
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

  // Le CTA primaire du Choose Trigger change selon la tab sélectionnée :
  // - Back Tap / AssistiveTouch → Réglages → Accessibilité
  // - Écran d'accueil → app Raccourcis (pour épingler le raccourci)
  const triggerPrimaryAction = () => {
    if (iosTrigger === 'homeScreen') {
      Linking.openURL('shortcuts://').catch(() => Linking.openSettings());
      return;
    }
    const path = iosTrigger === 'backTap'
      ? 'App-prefs:ACCESSIBILITY&path=TOUCH/BackTap'
      : 'App-prefs:ACCESSIBILITY&path=ASSISTIVE_TOUCH';
    Linking.openURL(path)
      .catch(() => Linking.openURL('App-prefs:ACCESSIBILITY'))
      .catch(() => Linking.openSettings());
  };
  const triggerPrimaryLabel = () =>
    iosTrigger === 'homeScreen'
      ? t('tutorial.openShortcuts', 'Ouvrir Raccourcis')
      : t('tutorial.iosTrigger.cta');

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
    const showCompactIcon = hasCustomBlock && !isDone;

    return (
      <View style={styles.slide}>
        {/* Glow background */}
        <View style={[styles.glowCircle, { backgroundColor: item.color + '08' }]} />
        <View style={[styles.glowCircleInner, { backgroundColor: item.color + '05' }]} />

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
          ) : isDone ? null : (
            <>
              <View style={styles.iconContainer}>
                <View style={[styles.iconRingOuter, { borderColor: item.color + '12' }]} />
                <View style={[styles.iconRingMiddle, { borderColor: item.color + '20' }]} />
                {item.key === '1' ? (
                  <Image
                    source={require('../assets/strive-logo.png')}
                    style={styles.iconLogoImg}
                  />
                ) : (
                  <SafeGradient
                    colors={[item.color + '25', item.color + '08']}
                    style={styles.iconWrap}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <MaterialCommunityIcons name={item.icon as any} size={52} color={item.color} />
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

          <Text style={[styles.stepTitle, hasCustomBlock && styles.stepTitleCompact]}>{t(item.titleKey)}</Text>
          <Text style={[styles.stepDesc, hasCustomBlock && styles.stepDescCompact]}>{t(item.descKey)}</Text>

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
                style={[styles.iosBigCta, { backgroundColor: item.color }]}
                onPress={installShortcut}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons
                  name={shortcutInstalled ? 'check-circle' : 'download'}
                  size={18}
                  color={colors.background}
                />
                <Text style={styles.iosBigCtaTxt}>{t('tutorial.iosInstall.cta')}</Text>
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

          {isDone ? (
            <Animated.View style={[styles.doneBlock, { opacity }]}>
              <View style={styles.doneCheckOuter}>
                <View style={styles.doneCheckInner}>
                  <Feather name="check" size={40} color={colors.background} />
                </View>
              </View>

              <View style={styles.qrCard}>
                <Text style={styles.qrCardTitle}>{t('tutorial.quickRef.subtitle')}</Text>
                <View style={styles.qrRow}>
                  {(Platform.OS === 'android' ? [
                    { icon: 'line-scan', color: '#4FC3F7', labelKey: 'tutorial.quickRef.android.step1', subKey: 'tutorial.quickRef.android.step1Sub' },
                    { icon: 'gesture-tap', color: colors.primary, labelKey: 'tutorial.quickRef.android.step2', subKey: 'tutorial.quickRef.android.step2Sub' },
                    { icon: 'check-decagram', color: '#FF8A65', labelKey: 'tutorial.quickRef.android.step3', subKey: 'tutorial.quickRef.android.step3Sub' },
                  ] : [
                    { icon: 'cellphone-screenshot', color: '#4FC3F7', labelKey: 'tutorial.quickRef.ios.step1', subKey: 'tutorial.quickRef.ios.step1Sub' },
                    { icon: 'gesture-tap-hold', color: colors.primary, labelKey: 'tutorial.quickRef.ios.step2', subKey: 'tutorial.quickRef.ios.step2Sub' },
                    { icon: 'check-decagram', color: '#FF8A65', labelKey: 'tutorial.quickRef.ios.step3', subKey: 'tutorial.quickRef.ios.step3Sub' },
                  ]).map((step, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && (
                        <View style={styles.qrArrow}>
                          <Feather name="chevron-right" size={14} color={colors.textDimmed} />
                        </View>
                      )}
                      <View style={styles.qrItem}>
                        <View style={[styles.qrIcon, { backgroundColor: step.color + '15', borderWidth: 1, borderColor: step.color + '25' }]}>
                          <MaterialCommunityIcons name={step.icon as any} size={26} color={step.color} />
                        </View>
                        <Text style={styles.qrLabel}>{t(step.labelKey)}</Text>
                        <Text style={styles.qrSub}>{t(step.subKey)}</Text>
                      </View>
                    </React.Fragment>
                  ))}
                </View>
              </View>
            </Animated.View>
          ) : null}

          {/* Slide iOS 3 — Choose Trigger (inspired by Trip Identifier) */}
          {isIosTrigger ? (
            <Animated.View style={[styles.iosTriggerBlock, { opacity }]}>
              <View style={styles.iosSegmented}>
                {(['backTap', 'assistive', 'homeScreen'] as IosTrigger[]).map(tr => {
                  const active = iosTrigger === tr;
                  return (
                    <TouchableOpacity
                      key={tr}
                      style={[styles.iosSegment, active && styles.iosSegmentActive]}
                      onPress={() => { hapticLight(); setIosTrigger(tr); }}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.iosSegmentTxt, active && styles.iosSegmentTxtActive]} numberOfLines={1}>
                        {t(`tutorial.iosTrigger.${tr}.label`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {iosTrigger === 'assistive' && (
                <Text style={styles.triggerRecommended}>{t('tutorial.iosTrigger.recommended')}</Text>
              )}

              <View style={styles.iosTriggerContent}>
                <View style={styles.triggerHeroCircle}>
                  <MaterialCommunityIcons
                    name={
                      iosTrigger === 'backTap' ? 'gesture-double-tap' :
                      iosTrigger === 'assistive' ? 'gesture-tap-hold' :
                      'apps'
                    }
                    size={32}
                    color={item.color}
                  />
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
        <TouchableOpacity onPress={() => { savePreferences(); navigation.goBack(); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel={t('tutorial.skip')}>
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
    width: width * 0.9,
    height: width * 0.9,
    borderRadius: width * 0.45,
    top: height * 0.06,
  },
  glowCircleInner: {
    position: 'absolute',
    width: width * 0.5,
    height: width * 0.5,
    borderRadius: width * 0.25,
    top: height * 0.06 + width * 0.2,
  },

  iconContainer: {
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 36,
  },
  iconRingOuter: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1.5,
  },
  iconRingMiddle: {
    position: 'absolute',
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 1,
  },
  iconWrap: {
    width: 108,
    height: 108,
    borderRadius: 54,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  iconLogoImg: {
    width: 108,
    height: 108,
    borderRadius: 28,
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
    marginTop: 18,
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
    gap: 10,
    marginBottom: 20,
  },
  presetCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  presetCardActive: {
    borderColor: colors.primary + '80',
    backgroundColor: colors.primary + '0A',
  },
  presetName: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  presetNameActive: { color: colors.primary },
  presetValue: {
    color: colors.textMain,
    fontSize: 22,
    fontWeight: '900',
  },
  presetValueActive: { color: colors.primary },
  presetSub: {
    color: colors.textDimmed,
    fontSize: 12,
    fontWeight: '600',
  },
  presetSubActive: { color: colors.primary + 'AA' },

  presetHint: {
    color: colors.textDimmed,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 18,
    fontStyle: 'italic',
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
    minHeight: 240,
  },
  triggerRecommended: {
    color: '#FFB300',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: 0.3,
  },
  triggerHeroCircle: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  triggerHeroLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 18,
  },
  triggerStepsList: {
    width: '100%',
    gap: 10,
    marginBottom: 16,
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
  doneCheckWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },
  doneBlock: {
    width: width - 48,
    alignItems: 'center',
    marginTop: 8,
  },
  doneCheckOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,230,118,0.06)',
    borderWidth: 2,
    borderColor: 'rgba(0,230,118,0.15)',
    marginBottom: 32,
  },
  doneCheckInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 28,
    elevation: 12,
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
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 20,
  },
  qrCardTitle: {
    color: colors.textDimmed,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  qrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  qrItem: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  qrIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  qrArrow: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrLabel: {
    color: colors.textMain,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  qrSub: {
    color: colors.textDimmed,
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 13,
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
