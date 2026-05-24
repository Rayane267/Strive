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
// l'installe en un tap. À créer une fois et coller ici.
const PREBUILT_SHORTCUT_URL: string | null = null; // ex: 'https://www.icloud.com/shortcuts/<id>'

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
              <View style={styles.iosMicroSteps}>
                {[1, 2, 3].map(n => (
                  <View key={n} style={styles.iosMicroRow}>
                    <View style={[styles.iosMicroNum, { backgroundColor: item.color + '20' }]}>
                      <Text style={[styles.iosMicroNumTxt, { color: item.color }]}>{n}</Text>
                    </View>
                    <Text style={styles.iosMicroTxt}>{t(`tutorial.iosInstall.step${n}`)}</Text>
                  </View>
                ))}
              </View>

              {!PREBUILT_SHORTCUT_URL ? (
                <View style={styles.iosWarn}>
                  <Feather name="alert-triangle" size={13} color="#FFB300" />
                  <Text style={styles.iosWarnTxt}>{t('tutorial.iosInstall.warning')}</Text>
                </View>
              ) : null}

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
              {/* Mock widget Lock Screen — match exact du SwiftUI `StriveLiveActivity` */}
              <View style={styles.dynamicIsland}>
                {/* ROW 1 : [Uber 53€/h] · [pill 17€] · [↑3.15€/km] */}
                <View style={styles.diRowTop}>
                  <View style={styles.diGroup}>
                    <Text style={styles.diPlatform}>Uber </Text>
                    <Text style={styles.diFare}>53€</Text>
                    <Text style={styles.diUnit}>/h</Text>
                  </View>
                  <View style={[styles.diFarePill, { backgroundColor: colors.primary }]}>
                    <Text style={styles.diFarePillTxt}>17€</Text>
                  </View>
                  <View style={styles.diGroup}>
                    <Feather name="arrow-up" size={12} color="#FFFFFF" style={{ marginRight: 1 }} />
                    <Text style={styles.diSecondaryTxt}>3.15€</Text>
                    <Text style={styles.diUnit}>/km</Text>
                  </View>
                </View>

                {/* ROW 2 : 🚗 ──●── 28min / 5.4km · ✓ */}
                <View style={styles.diRowBot}>
                  <View style={[styles.diCircle, { backgroundColor: colors.primary }]}>
                    <MaterialCommunityIcons name="car" size={11} color="#000" />
                  </View>
                  <View style={styles.diLineWrap}>
                    <View style={[styles.diLine, { backgroundColor: colors.primary }]} />
                    <View style={[styles.diLineDot, { backgroundColor: '#FFFFFF' }]} />
                  </View>
                  <View style={styles.diStatsCol}>
                    <Text style={styles.diStatTop} numberOfLines={1}>28min</Text>
                    <Text style={styles.diStatBot} numberOfLines={1}>5.4km</Text>
                  </View>
                  <View style={[styles.diCircle, { backgroundColor: colors.primary }]}>
                    <Feather name="check" size={11} color="#000" />
                  </View>
                </View>
              </View>

              <Text style={styles.iosPreviewHint}>
                <Feather name="check" size={11} color={colors.primary} /> {t('tutorial.iosPreview.verdictThreshold')}
              </Text>

              {/* "Ce que vous voyez en un coup d'œil" — 3 colonnes */}
              <Text style={styles.iosGlanceHeader}>{t('tutorial.iosPreview.glance')}</Text>
              <View style={styles.iosGlanceRow}>
                {[
                  { icon: 'clock' as const,        label: 'metricHr',    sub: 'metricHrSub' },
                  { icon: 'map-pin' as const,      label: 'metricKm',    sub: 'metricKmSub' },
                  { icon: 'dollar-sign' as const,  label: 'metricTotal', sub: 'metricTotalSub' },
                ].map((m, i) => (
                  <View key={i} style={styles.iosGlanceCol}>
                    <Feather name={m.icon} size={16} color={item.color} />
                    <Text style={styles.iosGlanceLabel}>{t(`tutorial.iosPreview.${m.label}`)}</Text>
                    <Text style={styles.iosGlanceSub}>{t(`tutorial.iosPreview.${m.sub}`)}</Text>
                  </View>
                ))}
              </View>

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

          {/* Slide iOS 3 — Choose Trigger (avec steps détaillés + secondary CTA) */}
          {isIosTrigger ? (
            <Animated.View style={[styles.iosTriggerBlock, { opacity }]}>
              {/* Tabs */}
              <View style={styles.iosTabs}>
                {(['backTap', 'assistive', 'homeScreen'] as IosTrigger[]).map(tr => {
                  const active = iosTrigger === tr;
                  return (
                    <TouchableOpacity
                      key={tr}
                      style={[styles.iosTab, active && { backgroundColor: item.color + '22', borderColor: item.color }]}
                      onPress={() => { hapticLight(); setIosTrigger(tr); }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.iosTabTxt, active && { color: item.color }]}>
                        {t(`tutorial.iosTrigger.${tr}.label`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Preview visuel du trigger sélectionné */}
              <View style={[styles.iosTriggerPreview, { borderColor: item.color + '30' }]}>
                <View style={[styles.iosTriggerPreviewIcon, { backgroundColor: item.color + '20' }]}>
                  <MaterialCommunityIcons
                    name={
                      iosTrigger === 'backTap' ? 'gesture-double-tap' :
                      iosTrigger === 'assistive' ? 'gesture-tap-hold' :
                      'apps'
                    }
                    size={28}
                    color={item.color}
                  />
                </View>
                <Text style={styles.iosTriggerPreviewTxt}>
                  {t(`tutorial.iosTrigger.${iosTrigger}.preview`)}
                </Text>
              </View>

              {/* Steps détaillés */}
              <View style={styles.iosTriggerSteps}>
                {[1, 2, 3].map(n => (
                  <View key={n} style={styles.iosMicroRow}>
                    <View style={[styles.iosMicroNum, { backgroundColor: item.color + '20' }]}>
                      <Text style={[styles.iosMicroNumTxt, { color: item.color }]}>{n}</Text>
                    </View>
                    <Text style={styles.iosMicroTxt}>
                      {t(`tutorial.iosTrigger.${iosTrigger}.step${n}`)}
                    </Text>
                  </View>
                ))}
              </View>

              {/* CTA primaire */}
              <TouchableOpacity
                style={[styles.iosBigCta, { backgroundColor: item.color }]}
                onPress={triggerPrimaryAction}
                activeOpacity={0.85}
              >
                <Feather name={iosTrigger === 'homeScreen' ? 'external-link' : 'settings'} size={17} color={colors.background} />
                <Text style={styles.iosBigCtaTxt}>{triggerPrimaryLabel()}</Text>
              </TouchableOpacity>

              {/* CTA secondaire — j'ai compris, suivant */}
              <TouchableOpacity
                style={styles.iosSecondaryCta}
                onPress={handleNext}
                activeOpacity={0.8}
              >
                <Feather name="check" size={14} color={colors.textMuted} />
                <Text style={styles.iosSecondaryTxt}>{t('tutorial.iosTrigger.doneCta')}</Text>
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

  // ── iOS Install slide ──
  iosInstallBlock: {
    width: '100%',
    marginTop: 20,
    alignItems: 'stretch',
  },
  iosMicroSteps: {
    gap: 10,
    marginBottom: 14,
  },
  iosMicroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iosMicroNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iosMicroNumTxt: {
    fontSize: 13,
    fontWeight: '800',
  },
  iosMicroTxt: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  iosWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,179,0,0.1)',
    borderColor: 'rgba(255,179,0,0.3)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 14,
  },
  iosWarnTxt: {
    flex: 1,
    color: '#FFB300',
    fontSize: 11,
    lineHeight: 16,
  },
  iosBigCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 20,
  },
  iosBigCtaTxt: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // ── iOS Trigger slide ──
  iosTriggerBlock: {
    width: '100%',
    marginTop: 20,
    alignItems: 'stretch',
  },
  iosTabs: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  iosTab: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
  },
  iosTabTxt: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  iosTriggerPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 14,
  },
  iosTriggerPreviewIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iosTriggerPreviewTxt: {
    flex: 1,
    color: colors.textMain,
    fontSize: 13,
    fontWeight: '700',
  },
  iosTriggerSteps: {
    gap: 10,
    marginBottom: 14,
  },

  // ── iOS Secondary CTA ──
  iosSecondaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginTop: 10,
  },
  iosSecondaryTxt: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },

  // ── iOS Preview slide (See It In Action) ──
  iosPreviewBlock: {
    width: '100%',
    marginTop: 16,
    alignItems: 'stretch',
  },
  // === Mock 1:1 du SwiftUI StriveLiveActivity.LockScreenView ===
  dynamicIsland: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.92)',
    marginBottom: 10,
    gap: 10,
  },
  diRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  diGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  diPlatform: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  diFare: {
    color: '#FFFFFF',             // toujours blanc, pas verdict color
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  diUnit: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 1,
  },
  diFarePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,            // capsule
  },
  diFarePillTxt: {
    color: '#000',
    fontSize: 14,
    fontWeight: '900',
  },
  diSecondaryTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },

  // Row 2
  diRowBot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  diCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diLineWrap: {
    flex: 1,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diLine: {
    height: 2,
    width: '100%',
  },
  diLineDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  diStatsCol: {
    alignItems: 'flex-end',
    minWidth: 44,
  },
  diStatTop: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 15,
  },
  diStatBot: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 13,
  },
  iosPreviewHint: {
    color: colors.textDimmed,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 18,
  },
  iosGlanceHeader: {
    color: colors.textMain,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  iosGlanceRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  iosGlanceCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  iosGlanceLabel: {
    color: colors.textMain,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  iosGlanceSub: {
    color: colors.textDimmed,
    fontSize: 9,
    textAlign: 'center',
    lineHeight: 12,
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
