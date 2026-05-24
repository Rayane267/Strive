import React from 'react';
import { Platform, StyleSheet, View, ViewProps } from 'react-native';
import LinearGradient, { LinearGradientProps } from 'react-native-linear-gradient';

type Props = LinearGradientProps & ViewProps & {
  children?: React.ReactNode;
};

/**
 * Cross-platform gradient wrapper.
 * - Android: passes through to LinearGradient (works fine).
 * - iOS: renders the gradient in absoluteFill behind a content View — avoids
 *   the known react-native-linear-gradient bug where children overflow rounded
 *   corners / get clipped when borderRadius + borderWidth are on the gradient.
 */
export default function SafeGradient({
  colors, start, end, locations, useAngle, angle, angleCenter,
  style, children, ...viewProps
}: Props) {
  if (Platform.OS === 'ios') {
    return (
      <View style={style} {...viewProps}>
        <LinearGradient
          colors={colors}
          start={start}
          end={end}
          locations={locations}
          useAngle={useAngle}
          angle={angle}
          angleCenter={angleCenter}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {children}
      </View>
    );
  }
  return (
    <LinearGradient
      colors={colors}
      start={start}
      end={end}
      locations={locations}
      useAngle={useAngle}
      angle={angle}
      angleCenter={angleCenter}
      style={style}
      {...viewProps}
    >
      {children}
    </LinearGradient>
  );
}
