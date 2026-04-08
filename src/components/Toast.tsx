import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { colors } from '../theme/colors';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastData {
  type: ToastType;
  title: string;
  message?: string;
}

const VARIANTS: Record<ToastType, { icon: string; accent: string; iconBg: string }> = {
  success: { icon: 'check-circle', accent: colors.primary,  iconBg: 'rgba(0,230,118,0.15)' },
  error:   { icon: 'x-circle',     accent: colors.danger,   iconBg: 'rgba(255,77,77,0.15)' },
  info:    { icon: 'info',          accent: '#60A5FA',       iconBg: 'rgba(96,165,250,0.15)' },
  warning: { icon: 'alert-triangle', accent: '#FFCA28',     iconBg: 'rgba(255,202,40,0.15)' },
};

// ─── Toast Component ─────────────────────────────────────────────────────────

interface ToastProps {
  data: ToastData | null;
  onDismiss: () => void;
  /** Distance from bottom in px — use 100 inside tab screens, 40 otherwise */
  bottomOffset?: number;
}

export const Toast = ({ data, onDismiss, bottomOffset = 100 }: ToastProps) => {
  const translateY = useRef(new Animated.Value(80)).current;
  const opacity    = useRef(new Animated.Value(0)).current;
  const timerRef   = useRef<NodeJS.Timeout | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.parallel([
      Animated.timing(translateY, { toValue: 80,  duration: 260, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 0,   duration: 220, useNativeDriver: true }),
    ]).start(() => onDismiss());
  }, [onDismiss, translateY, opacity]);

  useEffect(() => {
    if (!data) return;

    // Reset before entering
    translateY.setValue(80);
    opacity.setValue(0);

    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 75, friction: 11 }),
      Animated.timing(opacity,    { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();

    timerRef.current = setTimeout(dismiss, 3500);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;

  const v = VARIANTS[data.type];

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { bottom: bottomOffset, opacity, transform: [{ translateY }] },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity onPress={dismiss} activeOpacity={0.92} style={styles.card}>
        {/* Left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: v.accent }]} />

        {/* Icon */}
        <View style={[styles.iconWrap, { backgroundColor: v.iconBg }]}>
          <Feather name={v.icon as any} size={18} color={v.accent} />
        </View>

        {/* Text */}
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>{data.title}</Text>
          {data.message ? (
            <Text style={styles.message} numberOfLines={2}>{data.message}</Text>
          ) : null}
        </View>

        {/* Dismiss */}
        <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={15} color="rgba(255,255,255,0.35)" />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useToast = () => {
  const [toast, setToast] = useState<ToastData | null>(null);

  const showToast = useCallback((data: ToastData) => {
    setToast(null); // reset first to re-trigger animation if same type shown twice
    setTimeout(() => setToast(data), 50);
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  return { toast, showToast, dismissToast };
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 99,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F1C15',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 16,
    paddingVertical: 14,
    paddingRight: 14,
    gap: 12,
  },
  accentBar: {
    width: 4,
    alignSelf: 'stretch',
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  textWrap: { flex: 1, gap: 2 },
  title: { color: colors.textMain, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  message: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
