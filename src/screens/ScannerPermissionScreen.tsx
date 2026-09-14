import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, AppState, AppStateStatus, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { scannerService } from '../services/scanner';
import type { PermissionsStatus } from '../services/scanner/types';

import { openSettingsFor, openShortcutsApp } from '../utils/appSettings';
import { PREBUILT_SHORTCUT_URL } from '../utils/iosShortcut';
import { FIELD_TOP } from '../theme/field';
import ScreenField from '../components/ScreenField';

const IS_IOS = Platform.OS === 'ios';

// Android < 11 (API 30) a besoin d'une permission MediaProjection supplémentaire
const NEEDS_MEDIA_PROJECTION = Platform.OS === 'android' && (Platform.Version as number) < 30;

const defaultPerms: PermissionsStatus = {
  overlay: IS_IOS ? true : false,
  accessibility: IS_IOS ? true : false,
  needsMediaProjection: NEEDS_MEDIA_PROJECTION,
  mediaProjectionGranted: IS_IOS ? true : false,
};

const ScannerPermissionScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const [perms, setPerms] = useState<PermissionsStatus>(defaultPerms);
  const [requestingProjection, setRequestingProjection] = useState(false);

  const refresh = useCallback(async () => {
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

  // Sur iOS, les permissions sont toujours accordées (pas d'overlay/accessibility)
  const allGranted = IS_IOS ? true :
    perms.overlay &&
    perms.accessibility &&
    (!perms.needsMediaProjection || perms.mediaProjectionGranted);

  const handleRequestMediaProjection = async () => {
    setRequestingProjection(true);
    try {
      await scannerService.requestMediaProjectionPermission();
      await refresh();
    } catch {
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

  // ── Rendu iOS ──────────────────────────────────────────────────────────────
  if (IS_IOS) {
    // Le tap ouvre la fiche d'import du raccourci dans l'app Raccourcis : un
    // geste pour l'installer. `openShortcutsApp` ne sert plus que de filet si
    // l'URL iCloud est injoignable — l'app Raccourcis s'ouvre alors vide, et le
    // chauffeur doit composer le raccourci lui-même. C'est un pis-aller, pas un
    // chemin nominal.
    const openShortcuts = () => {
      Linking.openURL(PREBUILT_SHORTCUT_URL).catch(() => openShortcutsApp());
    };

    const openIosAccessibility = () => {
      // `App-prefs:ACCESSIBILITY&path=TOUCH/BackTap` visait juste, mais c'est un
      // schéma d'URL PRIVÉ : sans effet sur les iOS récents — la cascade de
      // `.catch` ne rattrapait rien, `openURL` résout sur un schéma inconnu — et
      // motif de rejet en revue (règle 2.5.1). Le tutoriel l'avait déjà retiré ;
      // cet écran gardait la vieille route, si bien que deux écrans de la même
      // app promettaient deux destinations différentes pour le même réglage.
      // `openSettingsFor` ne promet que ce qu'Apple autorise.
      openSettingsFor('accessibility');
    };

    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Pose en premier, donc derriere tout le reste. Il remplit la zone SOUS
            l'encoche, et `container` porte la meme couleur que son sommet : la
            bande de statut se confond avec lui au lieu de faire un bandeau. */}
        <ScreenField />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Feather name="x" size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('scanner.title')}</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.body}>
          <MaterialCommunityIcons name="gesture-double-tap" size={48} color={colors.primary} style={styles.icon} />
          <Text style={styles.title}>{t('scanner.iosTitle', 'Scanner via raccourci')}</Text>
          <Text style={styles.subtitle}>
            {t('scanner.iosSubtitle', 'Configurez un raccourci une seule fois — ensuite, double-tapez le dos de votre iPhone pour analyser une offre depuis Uber, Bolt ou Heetch.')}
          </Text>

          {/* Étape 1 — Créer le raccourci */}
          <View style={styles.step}>
            <View style={styles.stepLeft}>
              <View style={styles.stepIcon}>
                <Text style={styles.stepNum}>1</Text>
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>{t('scanner.iosStep1Title', 'Créez le raccourci')}</Text>
                <Text style={styles.stepDesc}>
                  {t('scanner.iosStep1Desc', 'Dans Raccourcis : « Prendre une capture d\'écran » puis « Analyser une course avec Strive ».')}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.stepBtn} onPress={openShortcuts}>
              <Text style={styles.stepBtnText}>{t('scanner.iosOpenShortcuts', 'Ouvrir Raccourcis')}</Text>
              <Feather name="chevron-right" size={14} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {/* Étape 2 — Assigner au Back Tap */}
          <View style={styles.step}>
            <View style={styles.stepLeft}>
              <View style={styles.stepIcon}>
                <Text style={styles.stepNum}>2</Text>
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>{t('scanner.iosStep2Title', 'Assignez au double-tap')}</Text>
                <Text style={styles.stepDesc}>
                  {t('scanner.iosStep2Desc', 'Réglages → Accessibilité → Toucher → Toucher l\'arrière → Toucher deux fois : choisissez votre raccourci.')}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.stepBtn} onPress={openIosAccessibility}>
              <Text style={styles.stepBtnText}>{t('scanner.iosOpenAccessibility', 'Ouvrir Réglages')}</Text>
              <Feather name="chevron-right" size={14} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {/* Étape 3 — Résultat Dynamic Island */}
          <View style={styles.step}>
            <View style={styles.stepLeft}>
              <View style={styles.stepIcon}>
                <Text style={styles.stepNum}>3</Text>
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>{t('scanner.iosStep3Title', 'Résultat dans la Dynamic Island')}</Text>
                <Text style={styles.stepDesc}>
                  {t('scanner.iosStep3Desc', 'Depuis Uber/Bolt/Heetch, tapez deux fois le dos de l\'iPhone. Le verdict s\'affiche en direct dans la Dynamic Island.')}
                </Text>
              </View>
            </View>
            <View style={styles.iosIconWrap}>
              <MaterialCommunityIcons name="dock-top" size={20} color={colors.primary} />
            </View>
          </View>

          <View style={styles.infoBox}>
            <Feather name="info" size={13} color={colors.textDimmed} />
            <Text style={styles.infoText}>
              {t('scanner.iosInfoText', 'L\'analyse tourne localement sur votre iPhone (Vision + Gemini en fallback). Aucune donnée personnelle n\'est collectée.')}
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
          >
            <Feather name="check" size={20} color={colors.background} />
            <Text style={styles.startBtnText}>
              {t('scanner.iosActivate', 'J\'ai compris')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Rendu Android (inchangé) ───────────────────────────────────────────────
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

        {/* Prominent disclosure — requis Google Play pour accessibility service */}
        <View style={styles.disclosureBox}>
          <View style={styles.disclosureHeader}>
            <Feather name="shield" size={16} color={colors.primary} />
            <Text style={styles.disclosureTitle}>{t('scanner.disclosureTitle', 'Pourquoi ces permissions ?')}</Text>
          </View>
          <Text style={styles.disclosureBody}>
            {t(
              'scanner.disclosureBody',
              'Strive utilise le service d\'accessibilité et la capture d\'écran UNIQUEMENT pour analyser par OCR les offres affichées dans Uber, Bolt et Heetch, à chaque fois que vous appuyez sur le bouton scan. Aucune donnée personnelle n\'est lue ni collectée. L\'analyse est locale, sur votre appareil.',
            )}
          </Text>
        </View>

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
  container: { flex: 1, backgroundColor: FIELD_TOP },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: colors.textMain, fontSize: 16, fontWeight: '700' },

  body: { flex: 1, paddingHorizontal: space.xl, paddingTop: space.xxl },

  icon: { alignSelf: 'center', marginBottom: space.xl },
  title: { color: colors.textMain, fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: space.sm },
  subtitle: {
    color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 21,
    marginBottom: space.xl, paddingHorizontal: space.sm,
  },

  disclosureBox: {
    backgroundColor: 'rgba(0,230,118,0.06)',
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.xl,
  },
  disclosureHeader: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm,
  },
  disclosureTitle: {
    color: colors.primary, fontSize: 13, fontWeight: '700',
  },
  disclosureBody: {
    color: colors.textMuted, fontSize: 12, lineHeight: 18,
  },

  step: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md, padding: space.lg, marginBottom: space.md,
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
  },
  stepDone: {
    borderColor: stroke.edge,
    backgroundColor: 'rgba(0,230,118,0.05)',
  },
  stepLeft: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 },
  stepIcon: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  stepIconDone: { backgroundColor: colors.primary },
  stepNum: { color: colors.textMain, fontSize: 15, fontWeight: '800' },
  stepText: { flex: 1 },
  stepTitle: { color: colors.textMain, fontSize: 14, fontWeight: '700', marginBottom: space.tight },
  stepDesc: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  stepBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    backgroundColor: 'rgba(0,230,118,0.1)',
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.full,
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
  },
  stepBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: stroke.edge,
  },
  stepBtnText: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  iosIconWrap: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: 'rgba(0,230,118,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.sm, padding: space.md, marginTop: space.sm,
  },
  infoText: { color: colors.textDimmed, fontSize: 12, lineHeight: 18, flex: 1 },

  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    alignSelf: 'center', marginTop: space.lg,
    paddingHorizontal: space.lg, paddingVertical: space.sm,
  },
  refreshText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },

  footer: { paddingHorizontal: space.xl, paddingBottom: space.lg },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    backgroundColor: colors.primary,
    height: 56, borderRadius: radius.full,
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
