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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SafeGradient from '../components/SafeGradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { hapticLight, hapticSuccess } from '../utils/haptics';

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
      { key: '1',       icon: 'steering',          color: colors.primary, titleKey: 'tutorial.step1.title',         descKey: 'tutorial.step1.desc',         tip: 'tutorial.tips.step1' },
      { key: 'preview', icon: 'eye-outline',       color: '#A78BFA',      titleKey: 'tutorial.iosPreview.title',    descKey: 'tutorial.iosPreview.subtitle', tip: '' },
      { key: '2',       icon: 'download-circle',   color: '#4FC3F7',      titleKey: 'tutorial.step2_ios.title',     descKey: 'tutorial.step2_ios.desc',     tip: '' },
      { key: '3',       icon: 'gesture-tap-button', color: colors.primary, titleKey: 'tutorial.step3_ios.title',     descKey: 'tutorial.step3_ios.desc',     tip: '' },
      { key: '4',       icon: 'chart-line',        color: '#FF8A65',      titleKey: 'tutorial.step4.title',         descKey: 'tutorial.step4.desc',         tip: 'tutorial.tips.step4' },
      { key: '5',       icon: 'rocket-launch',     color: colors.primary, titleKey: 'tutorial.step5_ios.title',     descKey: 'tutorial.step5_ios.desc',     tip: 'tutorial.tips.step5_ios' },
    ]
  : [
      { key: '1', icon: 'steering',       color: colors.primary, titleKey: 'tutorial.step1.title', descKey: 'tutorial.step1.desc', tip: 'tutorial.tips.step1' },
      { key: '2', icon: 'line-scan',      color: '#4FC3F7',      titleKey: 'tutorial.step2.title', descKey: 'tutorial.step2.desc', tip: 'tutorial.tips.step2' },
      { key: '3', icon: 'check-decagram', color: colors.primary, titleKey: 'tutorial.step3.title', descKey: 'tutorial.step3.desc', tip: 'tutorial.tips.step3' },
      { key: '4', icon: 'chart-line',     color: '#FF8A65',      titleKey: 'tutorial.step4.title', descKey: 'tutorial.step4.desc', tip: 'tutorial.tips.step4' },
      { key: '5', icon: 'rocket-launch',  color: colors.primary, titleKey: 'tutorial.step5.title', descKey: 'tutorial.step5.desc', tip: 'tutorial.tips.step5' },
    ]
) as readonly { key: string; icon: string; color: string; titleKey: string; descKey: string; tip: string }[];

const TutorialScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [currentIndex, setCurrentIndex] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [iosTrigger, setIosTrigger] = useState<IosTrigger>('assistive');
  const [shortcutInstalled, setShortcutInstalled] = useState(false);

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
    const hasCustomBlock = isIosPreview || isIosInstall || isIosTrigger;

    return (
      <View style={styles.slide}>
        {/* Glow background */}
        <View style={[styles.glowCircle, { backgroundColor: item.color + '08' }]} />
        <View style={[styles.glowCircleInner, { backgroundColor: item.color + '05' }]} />

        <Animated.View style={{ alignItems: 'center', opacity, transform: [{ scale }, { translateY }] }}>
          {hasCustomBlock ? (
            // Compact header pour slides iOS custom — gros icône + ring trop volumineux
            <SafeGradient
              colors={[item.color + '25', item.color + '08']}
              style={styles.iconCompact}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <MaterialCommunityIcons name={item.icon as any} size={26} color={item.color} />
            </SafeGradient>
          ) : (
            <>
              {/* Icon container with layered rings */}
              <View style={styles.iconContainer}>
                <View style={[styles.iconRingOuter, { borderColor: item.color + '12' }]} />
                <View style={[styles.iconRingMiddle, { borderColor: item.color + '20' }]} />
                <SafeGradient
                  colors={[item.color + '25', item.color + '08']}
                  style={styles.iconWrap}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <MaterialCommunityIcons name={item.icon as any} size={52} color={item.color} />
                </SafeGradient>
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

          {/* Slide iOS 2 — Install Shortcut */}
          {isIosInstall ? (
            <Animated.View style={[styles.iosInstallBlock, { opacity }]}>
              <SafeGradient
                colors={[item.color + '22', item.color + '06']}
                style={styles.iosHeroCard}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <View style={[styles.iosHeroIconWrap, { backgroundColor: item.color + '20', borderColor: item.color + '55' }]}>
                  <MaterialCommunityIcons name="lightning-bolt" size={30} color={item.color} />
                </View>
              </SafeGradient>

              <View style={styles.iosStepsList}>
                {[1, 2, 3].map(n => (
                  <View key={n} style={styles.iosStepRow}>
                    <View style={[styles.iosStepNum, { backgroundColor: item.color + '15', borderColor: item.color + '40' }]}>
                      <Text style={[styles.iosStepNumTxt, { color: item.color }]}>{n}</Text>
                    </View>
                    <Text style={styles.iosStepTxt}>{t(`tutorial.iosInstall.step${n}`)}</Text>
                  </View>
                ))}
              </View>

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

          {/* Slide iOS « See It In Action » — preview Dynamic Island */}
          {isIosPreview ? (
            <Animated.View style={[styles.iosPreviewBlock, { opacity }]}>
              {/* Lock screen context : faux time + dynamic island */}
              <View style={styles.iosLockFrame}>
                <Text style={styles.iosLockTime}>9:41</Text>
                {/* Mock 1:1 du SwiftUI StriveLiveActivity.LockScreenView */}
                <View style={styles.dynamicIsland}>
                  {/* Row 1 — Platform · €/h · spacer · Pill · KmRate */}
                  <View style={styles.diRowTop}>
                    <Text style={styles.diPlatform}>Uber</Text>
                    <View style={styles.diHourly}>
                      <Text style={styles.diHourlyValue}>€53</Text>
                      <Text style={styles.diHourlyUnit}>/h</Text>
                    </View>
                    <View style={{ flex: 1 }} />
                    <View style={[styles.diFarePill, { backgroundColor: 'rgba(0,199,82,0.28)', borderColor: 'rgba(0,199,82,0.85)' }]}>
                      <Text style={styles.diFarePillTxt}>€17</Text>
                    </View>
                    <View style={styles.diKmRate}>
                      <Feather name="arrow-up-right" size={11} color="#00C752" />
                      <Text style={styles.diKmRateTxt}>€3.15/km</Text>
                    </View>
                  </View>

                  {/* Row 2 — RouteRow : car · line+dot · stats · check */}
                  <View style={styles.diRouteRow}>
                    <View style={[styles.diRouteCircle, { backgroundColor: '#00C752' }]}>
                      <MaterialCommunityIcons name="car" size={12} color="#000" />
                    </View>
                    <View style={styles.diRouteLineWrap}>
                      <View style={[styles.diRouteLine, { backgroundColor: 'rgba(0,199,82,0.85)' }]} />
                      <View style={[styles.diRouteDot, { backgroundColor: '#00C752' }]} />
                    </View>
                    <View style={styles.diRouteStats}>
                      <Text style={styles.diRouteDuration}>28min</Text>
                      <Text style={styles.diRouteDistance}>5.4km</Text>
                    </View>
                    <View style={[styles.diRouteCircle, { backgroundColor: '#00C752' }]}>
                      <Feather name="check" size={12} color="#000" />
                    </View>
                  </View>
                </View>
              </View>

              <Text style={styles.iosPreviewHint}>
                <Feather name="check-circle" size={11} color={colors.primary} />  {t('tutorial.iosPreview.verdictThreshold')}
              </Text>

              <TouchableOpacity
                style={[styles.iosSecondaryCta, { borderColor: item.color + '50' }]}
                onPress={() => navigation.navigate('Preferences')}
                activeOpacity={0.8}
              >
                <Feather name="sliders" size={14} color={item.color} />
                <Text style={[styles.iosSecondaryTxt, { color: item.color }]}>
                  {t('tutorial.iosPreview.customizeCta')}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          ) : null}

          {/* Slide iOS 3 — Choose Trigger */}
          {isIosTrigger ? (
            <Animated.View style={[styles.iosTriggerBlock, { opacity }]}>
              {/* iOS-style segmented control */}
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

              {/* Hero illustrative card pour le trigger sélectionné */}
              <View style={[styles.iosTriggerHero, { borderColor: item.color + '30' }]}>
                <SafeGradient
                  colors={[item.color + '30', item.color + '0A']}
                  style={styles.iosTriggerHeroIcon}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <MaterialCommunityIcons
                    name={
                      iosTrigger === 'backTap' ? 'gesture-double-tap' :
                      iosTrigger === 'assistive' ? 'gesture-tap-hold' :
                      'apps'
                    }
                    size={30}
                    color={item.color}
                  />
                </SafeGradient>
                <Text style={styles.iosTriggerHeroTxt}>
                  {t(`tutorial.iosTrigger.${iosTrigger}.preview`)}
                </Text>
              </View>

              {/* Steps */}
              <View style={styles.iosStepsList}>
                {[1, 2, 3].map(n => (
                  <View key={n} style={styles.iosStepRow}>
                    <View style={[styles.iosStepNum, { backgroundColor: item.color + '15', borderColor: item.color + '40' }]}>
                      <Text style={[styles.iosStepNumTxt, { color: item.color }]}>{n}</Text>
                    </View>
                    <Text style={styles.iosStepTxt}>
                      {t(`tutorial.iosTrigger.${iosTrigger}.step${n}`)}
                    </Text>
                  </View>
                ))}
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
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel={t('tutorial.skip')}>
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
    width: width * 0.85,
    height: width * 0.85,
    borderRadius: width * 0.425,
    top: height * 0.08,
  },
  glowCircleInner: {
    position: 'absolute',
    width: width * 0.55,
    height: width * 0.55,
    borderRadius: width * 0.275,
    top: height * 0.08 + width * 0.15,
  },

  iconContainer: {
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  iconRingOuter: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
  },
  iconRingMiddle: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
  },
  iconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },

  stepBadge: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 20,
  },
  stepBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
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
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
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

  // Steps list (install + trigger)
  iosStepsList: {
    gap: 14,
    marginBottom: 18,
  },
  iosStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iosStepNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosStepNumTxt: {
    fontSize: 14,
    fontWeight: '800',
  },
  iosStepTxt: {
    flex: 1,
    color: colors.textMain,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },

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
    fontSize: 12,
    fontWeight: '600',
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
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.92)',
    gap: 12,
  },
  // Row 1 — Platform · €X/h · spacer · Pill · KmRate
  diRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  diPlatform: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
    fontWeight: '600',
  },
  diHourly: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 1,
  },
  diHourlyValue: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  diHourlyUnit: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '600',
  },
  diFarePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  diFarePillTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  diKmRate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  diKmRateTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  // Row 2 — RouteRow
  diRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  diRouteCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diRouteLineWrap: {
    flex: 1,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diRouteLine: {
    height: 3,
    width: '100%',
    borderRadius: 1.5,
  },
  diRouteDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  diRouteStats: {
    alignItems: 'flex-end',
    minWidth: 46,
  },
  diRouteDuration: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  diRouteDistance: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
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
