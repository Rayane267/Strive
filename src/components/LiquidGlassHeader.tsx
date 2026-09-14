import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import SafeGradient from './SafeGradient';
import Feather from 'react-native-vector-icons/Feather';
import { colors } from '../theme/colors';
import { space } from '../theme/spacing';
import { elevation } from '../theme/elevation';

interface Props {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

const LiquidGlassHeader = ({ title, subtitle, onBack, right }: Props) => {
  const insets = useSafeAreaInsets();
  const paddingTop = insets.top + 8;

  return (
    <View style={[styles.container, { paddingTop }]}>
      {Platform.OS === 'ios' ? (
        <>
          <BlurView
            style={StyleSheet.absoluteFill}
            blurType="chromeMaterialDark"
            blurAmount={28}
            reducedTransparencyFallbackColor={colors.background}
          />
          <View style={[StyleSheet.absoluteFill, styles.tint]} />
        </>
      ) : (
        <SafeGradient
          colors={[colors.background, '#0A1A12']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}

      <View style={styles.row}>
        {/* Bouton back */}
        <View style={styles.side}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
              <Feather name="chevron-left" size={26} color={colors.textMain} />
            </TouchableOpacity>
          )}
        </View>

        {/* Titre centré */}
        <View style={styles.center}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>

        {/* Slot droit */}
        <View style={styles.side}>
          {right ?? null}
        </View>
      </View>

      {/* Séparateur glass */}
      <View style={styles.separator} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    ...elevation.resting.shadow,
  },
  tint: {
    backgroundColor: 'rgba(10, 18, 14, 0.25)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingBottom: space.md,
  },
  side: {
    width: 52,
    alignItems: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textMain,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textDimmed,
    marginTop: space.tight,
  },
  separator: {
    height: 0,
  },
});

export default LiquidGlassHeader;
