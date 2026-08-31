/**
 * Diagnostic — lire ce que fait l'app quand elle rate, sans Mac.
 *
 * Jusqu'ici la seule façon de savoir pourquoi un scan n'affichait rien était
 * Console.app, un iPhone branché et un Mac. Cet écran met les deux sources sous
 * les yeux du chauffeur — et surtout sous les nôtres quand il nous envoie une
 * capture :
 *
 *   • la TRACE Live Activity (iOS), écrite par `LiveActivityManager.log()` dans
 *     l'App Group. Elle dit si la carte a été trouvée, si l'update est partie,
 *     si le Dashboard l'a écrasée. C'est la seule vue sur ActivityKit.
 *   • les ÉCHECS DE SCAN, lus dans `scan_failures` — motif normalisé, surface
 *     d'où le scan partait, détail. Ils viennent de la base, donc les deux
 *     plateformes en ont.
 *
 * La collecte de la trace est ÉTEINTE par défaut. Écrire dans un conteneur
 * partagé entre trois process à chaque étape du scan a un coût, et laisser des
 * données de diagnostic sur l'appareil sans que personne les demande n'a pas de
 * finalité. On l'allume le temps de reproduire, on la coupe après — et la couper
 * efface ce qui avait été collecté.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Platform,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import { scannerService } from '../services/scanner';
import { hapticLight } from '../utils/haptics';
import { resetSignupCounters } from '../utils/deviceId';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Failure = {
  id: number;
  reason: string;
  os: string | null;
  surface: string | null;
  platform: string | null;
  detail: string | null;
  created_at: string;
};

const DiagnosticsScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { user } = useAuth();

  const [tracing, setTracing] = useState(false);
  const [trace, setTrace] = useState('');
  const [failures, setFailures] = useState<Failure[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [presentations, setPresentations] =
    useState<{ expanded: number; compact: number; minimal: number; since: number } | null>(null);

  /// Redémarre une mesure propre. À faire juste avant une vacation : des
  /// compteurs qui cumulent plusieurs jours de tests au bureau ne disent rien
  /// des conditions réelles.
  const resetPresentations = useCallback(() => {
    hapticLight();
    scannerService.resetPresentationCounters?.();
    setPresentations(null);
  }, []);

  /**
   * Repart d'un appareil neuf : compteur d'inscriptions du Keychain vidé et
   * device_id régénéré. Le nouvel identifiant n'existant dans aucune table,
   * `device_signups` et `welcome_grants` repartent de zéro côté serveur aussi —
   * c'est ce qu'il faut pour rejouer un cycle création → suppression →
   * recréation, cadeau de bienvenue compris.
   */
  const resetCounters = useCallback(async () => {
    hapticLight();
    setResetting(true);
    try {
      await resetSignupCounters(true);
      Alert.alert(t('diagnostics.countersReset'), t('diagnostics.countersDone'));
    } finally {
      setResetting(false);
    }
  }, [t]);

  /**
   * Ouvre l'écran du cadeau avec des valeurs d'exemple, sans toucher à la base.
   * `thenPaywall: false` — on vient juger un écran, pas dérouler un tunnel.
   * Rejouable à l'infini : c'est tout l'intérêt pour régler une animation.
   */
  const openWelcomeGift = useCallback(() => {
    hapticLight();
    navigation.navigate('WelcomeGift', {
      amount: 30,
      expiresInDays: 14,
      thenPaywall: false,
    });
  }, [navigation]);

  /**
   * Réarme l'onboarding sans `pm clear` : seul le drapeau local tombe, la
   * session et le profil restent. Un redémarrage de l'app suffit ensuite —
   * `RootNavigator` relit la clé au montage, pas en continu.
   */
  const rearmOnboarding = useCallback(async () => {
    hapticLight();
    await AsyncStorage.multiRemove([
      '@strive_has_seen_onboarding',
      '@strive_has_seen_tutorial',
      // Le paywall de fin de cadeau ne se montre aussi qu'une fois.
      '@strive_welcome_paywall_seen',
      // Déclaration « j'ai ajouté le raccourci » du tutoriel iOS : sans elle,
      // le rejeu repartirait avec la slide Installation déjà cochée en vert.
      '@strive_shortcut_declared',
    ]);
    Alert.alert(t('diagnostics.replayOnboarding'), t('diagnostics.replayDone'));
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    const diag = await scannerService.getDiagnostics?.();
    if (diag) {
      setTracing(diag.tracing);
      setTrace(diag.trace);
      setPresentations(diag.presentations ?? null);
    }
    if (user?.id) {
      // Trente derniers échecs. La table est purgée à 30 jours côté base, donc
      // ce qui n'y est plus n'existe nulle part — inutile de paginer.
      const { data } = await supabase
        .from('scan_failures')
        .select('id, reason, os, surface, platform, detail, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);
      setFailures((data as Failure[]) ?? []);
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const toggleTracing = (next: boolean) => {
    hapticLight();
    setTracing(next);
    scannerService.setDiagnosticsTracing?.(next);
    if (!next) setTrace('');
  };

  const clear = () => {
    hapticLight();
    scannerService.clearDiagnostics?.();
    setTrace('');
  };

  /// Partage plutôt que copie : le projet n'embarque pas de module de
  /// presse-papiers, et la feuille de partage native permet d'envoyer la trace
  /// directement dans un message — ce qu'on veut, c'est la recevoir.
  const share = async () => {
    const body = [
      `— ${t('diagnostics.traceTitle')} —`,
      trace || t('diagnostics.traceEmpty'),
      '',
      `— ${t('diagnostics.failuresTitle')} —`,
      ...failures.map(f =>
        `${f.created_at} · ${f.reason}${f.surface ? ` · ${f.surface}` : ''}${f.detail ? ` · ${f.detail}` : ''}`,
      ),
    ].join('\n');
    try {
      await Share.share({ message: body });
    } catch {
      // Feuille refermée sans partager : rien à signaler.
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.canGoBack() && navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="chevron-left" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('diagnostics.title')}</Text>
        <TouchableOpacity onPress={share} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="share-2" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Collecte ── */}
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchTexts}>
              <Text style={styles.cardTitle}>{t('diagnostics.tracingTitle')}</Text>
              <Text style={styles.cardSub}>{t('diagnostics.tracingSub')}</Text>
            </View>
            <Switch
              value={tracing}
              onValueChange={toggleTracing}
              trackColor={{ false: 'rgba(255,255,255,0.14)', true: 'rgba(0,230,118,0.4)' }}
              thumbColor={tracing ? colors.primary : '#8F9B96'}
            />
          </View>
          {Platform.OS !== 'ios' && (
            <Text style={styles.note}>{t('diagnostics.androidNote')}</Text>
          )}
        </View>

        {/* ── Trace Live Activity ── */}
        <Text style={styles.sectionTitle}>{t('diagnostics.traceTitle')}</Text>
        <View style={styles.card}>
          {trace ? (
            <Text style={styles.mono} selectable>{trace.trim()}</Text>
          ) : (
            <Text style={styles.empty}>
              {tracing ? t('diagnostics.traceWaiting') : t('diagnostics.traceEmpty')}
            </Text>
          )}
        </View>
        {trace ? (
          <TouchableOpacity style={styles.clearBtn} onPress={clear}>
            <Feather name="trash-2" size={14} color={colors.textDimmed} />
            <Text style={styles.clearTxt}>{t('diagnostics.clear')}</Text>
          </TouchableOpacity>
        ) : null}

        {/* ── Échecs de scan ── */}
        <Text style={styles.sectionTitle}>{t('diagnostics.failuresTitle')}</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : failures.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.empty}>{t('diagnostics.failuresEmpty')}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {failures.map((f, i) => (
              <View key={f.id} style={[styles.failRow, i > 0 && styles.failRowBorder]}>
                <View style={styles.failHead}>
                  <Text style={styles.failReason}>{f.reason}</Text>
                  <Text style={styles.failDate}>
                    {new Date(f.created_at).toLocaleString()}
                  </Text>
                </View>
                <Text style={styles.failMeta}>
                  {[f.os, f.surface, f.platform].filter(Boolean).join(' · ')}
                </Text>
                {f.detail ? <Text style={styles.failDetail}>{f.detail}</Text> : null}
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.reload} onPress={load}>
          <Feather name="refresh-cw" size={14} color={colors.primary} />
          <Text style={styles.reloadTxt}>{t('diagnostics.reload')}</Text>
        </TouchableOpacity>

        {/* ── Présentations du Dynamic Island ── */}
        {/* La question à laquelle ça répond : est-ce que le résultat s'affiche
            dans l'îlot DÉPLIÉ, ou seulement en compact ? Aucune API ne le dit,
            donc le widget compte ses propres rendus. « déplié : 0 » sur une
            vacation entière est une preuve ; un chiffre haut est un majorant
            (le système prépare parfois une vue sans l'afficher). */}
        {Platform.OS === 'ios' && (
          <>
            <Text style={styles.sectionTitle}>{t('diagnostics.presTitle')}</Text>
            <View style={styles.card}>
              {!tracing ? (
                <Text style={styles.empty}>{t('diagnostics.presNeedsTracing')}</Text>
              ) : !presentations || !presentations.since ? (
                <Text style={styles.empty}>{t('diagnostics.presWaiting')}</Text>
              ) : (
                <>
                  <View style={styles.failRow}>
                    <View style={styles.failHead}>
                      <Text style={styles.failReason}>{t('diagnostics.presExpanded')}</Text>
                      <Text style={styles.failReason}>{presentations.expanded}</Text>
                    </View>
                  </View>
                  <View style={[styles.failRow, styles.failRowBorder]}>
                    <View style={styles.failHead}>
                      <Text style={styles.failReason}>{t('diagnostics.presCompact')}</Text>
                      <Text style={styles.failReason}>{presentations.compact}</Text>
                    </View>
                  </View>
                  <View style={[styles.failRow, styles.failRowBorder]}>
                    <View style={styles.failHead}>
                      <Text style={styles.failReason}>{t('diagnostics.presMinimal')}</Text>
                      <Text style={styles.failReason}>{presentations.minimal}</Text>
                    </View>
                  </View>
                  <Text style={styles.failMeta}>
                    {t('diagnostics.presSince', {
                      date: new Date(presentations.since * 1000).toLocaleString(),
                    })}
                  </Text>
                </>
              )}
            </View>
            <TouchableOpacity style={styles.reload} onPress={resetPresentations}>
              <Feather name="rotate-ccw" size={14} color={colors.primary} />
              <Text style={styles.reloadTxt}>{t('diagnostics.presReset')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Rejouer les écrans de premier lancement ── */}
        {/* Pourquoi ces boutons existent : l'écran du cadeau ne s'ouvre qu'une
            fois par compte ET par appareil — deux gardes en base, volontaires en
            production. Pour les revoir il fallait donc une remise à zéro SQL,
            un `pm clear`, une reconnexion et six écrans de questions, à chaque
            retouche. Ici c'est une tape. L'écran Diagnostic étant hors du build
            App Store, aucun chauffeur ne les voit. */}
        <Text style={styles.sectionTitle}>{t('diagnostics.replayTitle')}</Text>
        <View style={styles.card}>
          <Text style={styles.empty}>{t('diagnostics.replayHint')}</Text>
        </View>
        <TouchableOpacity style={styles.reload} onPress={openWelcomeGift}>
          <Feather name="gift" size={14} color={colors.primary} />
          <Text style={styles.reloadTxt}>{t('diagnostics.replayGift')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.reload} onPress={rearmOnboarding}>
          <Feather name="rotate-ccw" size={14} color={colors.primary} />
          <Text style={styles.reloadTxt}>{t('diagnostics.replayOnboarding')}</Text>
        </TouchableOpacity>

        {/* ── Compteurs anti-abus ── */}
        {/* Uniquement là parce que cet écran est hors du build App Store. Le
            compteur d'inscriptions vit dans le Keychain, qui survit à la
            désinstallation : sans ce bouton, trois cycles de test suffisent à
            se bannir de son propre téléphone pour 60 jours, sans recours. */}
        <Text style={styles.sectionTitle}>{t('diagnostics.countersTitle')}</Text>
        <View style={styles.card}>
          <Text style={styles.empty}>{t('diagnostics.countersHint')}</Text>
        </View>
        <TouchableOpacity style={styles.reload} onPress={resetCounters} disabled={resetting}>
          <Feather name="rotate-ccw" size={14} color={colors.primary} />
          <Text style={styles.reloadTxt}>
            {resetting ? t('diagnostics.countersResetting') : t('diagnostics.countersReset')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const HAIRLINE = 'rgba(255,255,255,0.07)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  headerTitle: { color: colors.textMain, fontSize: 17, fontWeight: '800', flex: 1 },

  scroll: { paddingHorizontal: 16, paddingBottom: 40 },

  sectionTitle: {
    color: colors.textDimmed, fontSize: 11, fontWeight: '800',
    letterSpacing: 1.4, textTransform: 'uppercase',
    marginTop: 26, marginBottom: 10, marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: HAIRLINE,
    padding: 16,
  },
  cardTitle: { color: colors.textMain, fontSize: 15, fontWeight: '700' },
  cardSub: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 3 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  switchTexts: { flex: 1 },
  note: {
    color: colors.textDimmed, fontSize: 12, lineHeight: 18,
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: HAIRLINE,
  },

  mono: {
    color: colors.textMain, fontSize: 11, lineHeight: 17,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  empty: { color: colors.textDimmed, fontSize: 13, lineHeight: 19 },

  clearBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, paddingVertical: 12, marginTop: 4,
  },
  clearTxt: { color: colors.textDimmed, fontSize: 13, fontWeight: '600' },

  loader: { marginTop: 14 },
  failRow: { paddingVertical: 12 },
  failRowBorder: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  failHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  failReason: { color: colors.danger, fontSize: 14, fontWeight: '800' },
  failDate: { color: colors.textDimmed, fontSize: 11 },
  failMeta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  failDetail: {
    color: colors.textDimmed, fontSize: 12, lineHeight: 18, marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  reload: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, marginTop: 18,
  },
  reloadTxt: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});

export default DiagnosticsScreen;
