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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { hapticLight, hapticSuccess } from '../utils/haptics';

const { width, height } = Dimensions.get('window');

const STEPS = [
  { key: '1', icon: 'steering',       color: colors.primary, titleKey: 'tutorial.step1.title', descKey: 'tutorial.step1.desc', tip: 'tutorial.tips.step1' },
  { key: '2', icon: 'line-scan',      color: '#4FC3F7',      titleKey: 'tutorial.step2.title', descKey: 'tutorial.step2.desc', tip: 'tutorial.tips.step2' },
  { key: '3', icon: 'check-decagram', color: colors.primary, titleKey: 'tutorial.step3.title', descKey: 'tutorial.step3.desc', tip: 'tutorial.tips.step3' },
  { key: '4', icon: 'chart-line',     color: '#FF8A65',      titleKey: 'tutorial.step4.title', descKey: 'tutorial.step4.desc', tip: 'tutorial.tips.step4' },
  { key: '5', icon: 'rocket-launch',  color: colors.primary, titleKey: 'tutorial.step5.title', descKey: 'tutorial.step5.desc', tip: 'tutorial.tips.step5' },
] as const;

const TutorialScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [currentIndex, setCurrentIndex] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

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

  const renderStep = ({ item, index }: { item: typeof STEPS[number]; index: number }) => {
    const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
    const scale = scrollX.interpolate({ inputRange, outputRange: [0.7, 1, 0.7], extrapolate: 'clamp' });
    const opacity = scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
    const translateY = scrollX.interpolate({ inputRange, outputRange: [30, 0, 30], extrapolate: 'clamp' });

    const tipText = t(item.tip, { defaultValue: '' });

    return (
      <View style={styles.slide}>
        {/* Glow background */}
        <View style={[styles.glowCircle, { backgroundColor: item.color + '08' }]} />
        <View style={[styles.glowCircleInner, { backgroundColor: item.color + '05' }]} />

        <Animated.View style={{ alignItems: 'center', opacity, transform: [{ scale }, { translateY }] }}>
          {/* Icon container with layered rings */}
          <View style={styles.iconContainer}>
            <View style={[styles.iconRingOuter, { borderColor: item.color + '12' }]} />
            <View style={[styles.iconRingMiddle, { borderColor: item.color + '20' }]} />
            <LinearGradient
              colors={[item.color + '25', item.color + '08']}
              style={styles.iconWrap}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <MaterialCommunityIcons name={item.icon as any} size={52} color={item.color} />
            </LinearGradient>
          </View>

          {/* Step badge */}
          <View style={[styles.stepBadge, { backgroundColor: item.color + '18' }]}>
            <Text style={[styles.stepBadgeText, { color: item.color }]}>
              {t('tutorial.step', { defaultValue: 'STEP' })} {index + 1}
            </Text>
          </View>

          <Text style={styles.stepTitle}>{t(item.titleKey)}</Text>
          <Text style={styles.stepDesc}>{t(item.descKey)}</Text>

          {/* Interactive tip card */}
          {tipText ? (
            <Animated.View style={[styles.tipCard, { opacity }]}>
              <View style={[styles.tipIcon, { backgroundColor: item.color + '15' }]}>
                <Feather name="zap" size={14} color={item.color} />
              </View>
              <Text style={styles.tipText}>{tipText}</Text>
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
          <LinearGradient
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
          </LinearGradient>
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
  stepDesc: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
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
