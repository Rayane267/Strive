import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, AppState, AppStateStatus, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { scannerService } from '../services/scanner';
import type { PermissionsStatus } from '../services/scanner/types';

// Android < 11 (API 30) a besoin d'une permission MediaProjection supplémentaire
const NEEDS_MEDIA_PROJECTION = Platform.OS === 'android' && (Platform.Version as number) < 30;

const defaultPerms: PermissionsStatus = {
  overlay: false,
  accessibility: false,
  needsMediaProjection: NEEDS_MEDIA_PROJECTION,
  mediaProjectionGranted: false,
};

const ScannerPermissionScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const [perms, setPerms] = useState<PermissionsStatus>(defaultPerms);
  const [requestingProjection, setRequestingProjection] = useState(false);

  const refresh = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    const result = await scannerService.checkPermissions();
    setPerms(result);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const allGranted =
    perms.overlay &&
    perms.accessibility &&
    (!perms.needsMediaProjection || perms.mediaProjectionGranted);

  const handleRequestMediaProjection = async () => {
    setRequestingProjection(true);
    try {
      await scannerService.requestMediaProjectionPermission();
      await refresh();
    } catch {
      // refusé par l'utilisateur — refresh pour refléter l'état
      await refresh();
    } finally {
      setRequestingProjection(false);
    }
  };

  const handleStart = async () => {
    try {
      await scannerService.start();
      navigation.goBack();
    } catch {
      refresh();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="x" size={20} color={colors.textMuted} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('scanner.title')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.body}>

        <MaterialCommunityIcons name="line-scan" size={48} color={colors.primary} style={styles.icon} />
        <Text style={styles.title}>
          {NEEDS_MEDIA_PROJECTION ? t('scanner.threePerms') : t('scanner.twoPerms')}
        </Text>
        <Text style={styles.subtitle}>{t('scanner.subtitle')}</Text>

        {/* Étape 1 — Overlay */}
        <View style={[styles.step, perms.overlay && styles.stepDone]}>
          <View style={styles.stepLeft}>
            <View style={[styles.stepIcon, perms.overlay && styles.stepIconDone]}>
              {perms.overlay
                ? <Feather name="check" size={18} color={colors.background} />
                : <Text style={styles.stepNum}>1</Text>
              }
            </View>
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>{t('scanner.overlayTitle')}</Text>
              <Text style={styles.stepDesc}>
                {perms.overlay ? t('scanner.overlayGranted') : t('scanner.overlayDesc')}
              </Text>
            </View>
          </View>
          {!perms.overlay && (
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => scannerService.openOverlayPermissionSettings()}
            >
              <Text style={styles.stepBtnText}>{t('scanner.open')}</Text>
              <Feather name="chevron-right" size={14} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Étape 2 — Accessibility */}
        <View style={[styles.step, perms.accessibility && styles.stepDone]}>
          <View style={styles.stepLeft}>
            <View style={[styles.stepIcon, perms.accessibility && styles.stepIconDone]}>
              {perms.accessibility
                ? <Feather name="check" size={18} color={colors.background} />
                : <Text style={styles.stepNum}>2</Text>
              }
            </View>
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>{t('scanner.accessibilityTitle')}</Text>
              <Text style={styles.stepDesc}>
                {perms.accessibility ? t('scanner.accessibilityGranted') : t('scanner.accessibilityDesc')}
              </Text>
            </View>
          </View>
          {!perms.accessibility && (
            <TouchableOpacity
              style={[styles.stepBtn, !perms.overlay && styles.stepBtnDisabled]}
              onPress={() => perms.overlay && scannerService.openAccessibilitySettings()}
            >
              <Text style={[styles.stepBtnText, !perms.overlay && { color: colors.textDimmed }]}>{t('scanner.open')}</Text>
              <Feather name="chevron-right" size={14} color={perms.overlay ? colors.primary : colors.textDimmed} />
            </TouchableOpacity>
          )}
        </View>

        {/* Étape 3 — MediaProjection (Android < 11 uniquement) */}
        {NEEDS_MEDIA_PROJECTION && (
          <View style={[styles.step, perms.mediaProjectionGranted && styles.stepDone]}>
            <View style={styles.stepLeft}>
              <View style={[styles.stepIcon, perms.mediaProjectionGranted && styles.stepIconDone]}>
                {perms.mediaProjectionGranted
                  ? <Feather name="check" size={18} color={colors.background} />
                  : <Text style={styles.stepNum}>3</Text>
                }
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>{t('scanner.captureTitle')}</Text>
                <Text style={styles.stepDesc}>
                  {perms.mediaProjectionGranted ? t('scanner.captureGranted') : t('scanner.captureDesc')}
                </Text>
              </View>
            </View>
            {!perms.mediaProjectionGranted && (
              <TouchableOpacity
                style={[
                  styles.stepBtn,
                  (!perms.overlay || !perms.accessibility) && styles.stepBtnDisabled,
                ]}
                onPress={() => {
                  if (perms.overlay && perms.accessibility) handleRequestMediaProjection();
                }}
                disabled={requestingProjection}
              >
                <Text style={[
                  styles.stepBtnText,
                  (!perms.overlay || !perms.accessibility) && { color: colors.textDimmed },
                ]}>
                  {requestingProjection ? t('scanner.allowing') : t('scanner.allow')}
                </Text>
                {!requestingProjection && (
                  <Feather
                    name="chevron-right"
                    size={14}
                    color={(perms.overlay && perms.accessibility) ? colors.primary : colors.textDimmed}
                  />
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.infoBox}>
          <Feather name="info" size={13} color={colors.textDimmed} />
          <Text style={styles.infoText}>{t('scanner.infoText')}</Text>
        </View>

        <TouchableOpacity style={styles.refreshBtn} onPress={refresh}>
          <Feather name="refresh-cw" size={14} color={colors.textMuted} />
          <Text style={styles.refreshText}>{t('scanner.refresh')}</Text>
        </TouchableOpacity>

      </View>

      {/* CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.startBtn, !allGranted && styles.startBtnDisabled]}
          onPress={handleStart}
          disabled={!allGranted}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons
            name="line-scan"
            size={20}
            color={allGranted ? colors.background : colors.textDimmed}
          />
          <Text style={[styles.startBtnText, !allGranted && { color: colors.textDimmed }]}>
            {allGranted ? t('scanner.start') : t('scanner.waiting')}
          </Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: colors.textMain, fontSize: 16, fontWeight: '700' },

  body: { flex: 1, paddingHorizontal: 20, paddingTop: 32 },

  icon: { alignSelf: 'center', marginBottom: 20 },
  title: { color: colors.textMain, fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: 10 },
  subtitle: {
    color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 21,
    marginBottom: 32, paddingHorizontal: 8,
  },

  step: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 18, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  stepDone: {
    borderColor: 'rgba(0,230,118,0.3)',
    backgroundColor: 'rgba(0,230,118,0.05)',
  },
  stepLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  stepIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  stepIconDone: { backgroundColor: colors.primary },
  stepNum: { color: colors.textMain, fontSize: 15, fontWeight: '800' },
  stepText: { flex: 1 },
  stepTitle: { color: colors.textMain, fontSize: 14, fontWeight: '700', marginBottom: 3 },
  stepDesc: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  stepBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,230,118,0.1)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.25)',
  },
  stepBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  stepBtnText: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12, padding: 12, marginTop: 8,
  },
  infoText: { color: colors.textDimmed, fontSize: 12, lineHeight: 18, flex: 1 },

  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'center', marginTop: 16,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  refreshText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },

  footer: { paddingHorizontal: 20, paddingBottom: 16 },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.primary,
    height: 56, borderRadius: 16,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5, shadowRadius: 14, elevation: 10,
  },
  startBtnDisabled: {
    backgroundColor: colors.surface,
    shadowOpacity: 0,
    elevation: 0,
  },
  startBtnText: { color: colors.background, fontSize: 16, fontWeight: '800' },
});

export default ScannerPermissionScreen;
