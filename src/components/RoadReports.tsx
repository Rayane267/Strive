import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMarketT } from '../hooks/useMarketT';
import { ROAD_REPORT_KINDS, type RoadReport, type RoadReportKind } from '../services/roadReportsService';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { elevation } from '../theme/elevation';

/**
 * Une couleur franche par catégorie, et une icône : sur une carte sombre, au
 * volant, c'est la forme et la teinte qui se lisent, pas le texte. `ink` est
 * l'encre posée sur la pastille — sombre sur le jaune et l'orange, où le blanc
 * ne se lit plus.
 */
export const REPORT_STYLE: Record<RoadReportKind, { icon: string; color: string; ink: string }> = {
  police: { icon: 'police-badge', color: '#3D7BFF', ink: '#FFFFFF' },
  accident: { icon: 'car-emergency', color: colors.danger, ink: '#FFFFFF' },
  danger: { icon: 'alert', color: '#FF9F0A', ink: '#1A1200' },
  traffic: { icon: 'car-multiple', color: '#B05CFF', ink: '#FFFFFF' },
  roadworks: { icon: 'traffic-cone', color: '#FFD60A', ink: '#1A1600' },
};

/** Hauteur du bouton « Signaler » : la carte de proximité se pose au-dessus. */
export const REPORT_FAB_HEIGHT = 48;

/** L'épingle posée sur la carte. */
export const ReportPin = ({ kind }: { kind: RoadReportKind }) => {
  const s = REPORT_STYLE[kind];
  return (
    <View style={[styles.pin, { backgroundColor: s.color }]}>
      <MaterialCommunityIcons name={s.icon} size={18} color={s.ink} />
    </View>
  );
};

/** Le bouton flottant « Signaler ». Pendant la recherche de position, il le dit. */
export const ReportButton = ({
  onPress,
  locating,
  style,
}: {
  onPress: () => void;
  locating: boolean;
  style?: StyleProp<ViewStyle>;
}) => {
  const { t } = useMarketT();
  return (
    <TouchableOpacity
      style={[styles.fab, style]}
      onPress={onPress}
      disabled={locating}
      accessibilityRole="button"
      accessibilityLabel={t('reports.button')}
    >
      {locating ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <MaterialCommunityIcons name="alert-plus" size={22} color={colors.onPrimary} />
      )}
      <Text style={styles.fabText}>{locating ? t('reports.locating') : t('reports.button')}</Text>
    </TouchableOpacity>
  );
};

/** Contenu de la feuille « Que se passe-t-il ? » : cinq grosses cibles, un geste. */
export const ReportPicker = ({
  onPick,
  busy,
}: {
  onPick: (kind: RoadReportKind) => void;
  busy: RoadReportKind | null;
}) => {
  const { t } = useMarketT();
  return (
    <>
      <Text style={styles.title}>{t('reports.pickTitle')}</Text>
      <Text style={styles.subtitle}>{t('reports.pickSubtitle')}</Text>
      <View style={styles.grid}>
        {ROAD_REPORT_KINDS.map(kind => {
          const s = REPORT_STYLE[kind];
          return (
            <TouchableOpacity
              key={kind}
              style={styles.kind}
              onPress={() => onPick(kind)}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel={t(`reports.kind.${kind}`)}
            >
              <View style={[styles.kindIcon, { backgroundColor: s.color }, busy !== null && busy !== kind && styles.faded]}>
                {busy === kind ? (
                  <ActivityIndicator color={s.ink} />
                ) : (
                  <MaterialCommunityIcons name={s.icon} size={30} color={s.ink} />
                )}
              </View>
              <Text style={styles.kindLabel} numberOfLines={1}>
                {t(`reports.kind.${kind}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
};

/** « Signalé il y a 12 min », « il y a 2 h », « à l'instant ». */
function sinceText(t: (key: string, opts?: any) => string, iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return t('reports.justNow');
  if (minutes < 60) return t('reports.minutesAgo', { count: minutes });
  return t('reports.hoursAgo', { count: Math.round(minutes / 60) });
}

/** Contenu de la feuille d'un signalement : la question de Waze, deux réponses. */
export const ReportDetails = ({
  report,
  onVote,
  busy,
}: {
  report: RoadReport;
  onVote: (stillThere: boolean) => void;
  busy: boolean;
}) => {
  const { t } = useMarketT();
  const s = REPORT_STYLE[report.kind];
  const meta = [
    sinceText(t, report.created_at),
    report.confirmations > 0 ? t('reports.confirmed', { count: report.confirmations }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <View style={styles.head}>
        <View style={[styles.headIcon, { backgroundColor: s.color }]}>
          <MaterialCommunityIcons name={s.icon} size={30} color={s.ink} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>{t(`reports.kind.${report.kind}`)}</Text>
          <Text style={styles.subtitle}>{meta}</Text>
        </View>
      </View>

      {report.mine ? (
        <>
          <Text style={styles.note}>{t('reports.mine')}</Text>
          <TouchableOpacity
            style={[styles.btn, styles.btnSolo, styles.btnSecondary]}
            onPress={() => onVote(false)}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.btnSecondaryText}>{t('reports.withdraw')}</Text>
          </TouchableOpacity>
        </>
      ) : report.voted ? (
        <Text style={styles.note}>{t('reports.voted')}</Text>
      ) : (
        <>
          <Text style={styles.question}>{t('reports.stillThere')}</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, styles.flex]}
              onPress={() => onVote(true)}
              disabled={busy}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="thumb-up" size={18} color={colors.onPrimary} />
              <Text style={styles.btnPrimaryText}>{t('reports.yes')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary, styles.flex]}
              onPress={() => onVote(false)}
              disabled={busy}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="thumb-down" size={18} color={colors.textMain} />
              <Text style={styles.btnSecondaryText}>{t('reports.no')}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </>
  );
};

/**
 * La question de Waze, posée sans ouvrir de feuille : le chauffeur passe à côté
 * d'un signalement, une carte compacte demande s'il est toujours là. Un geste
 * suffit, et elle s'efface seule si on l'ignore.
 */
export const ReportNearbyCard = ({
  report,
  meters,
  busy,
  onVote,
  onClose,
  style,
}: {
  report: RoadReport;
  meters: number;
  busy: boolean;
  onVote: (stillThere: boolean) => void;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}) => {
  const { t } = useMarketT();
  const s = REPORT_STYLE[report.kind];
  return (
    <View style={[styles.nearby, style]}>
      <View style={styles.head}>
        <View style={[styles.nearbyIcon, { backgroundColor: s.color }]}>
          <MaterialCommunityIcons name={s.icon} size={22} color={s.ink} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.nearbyTitle} numberOfLines={1}>
            {t('reports.nearbyTitle', { kind: t(`reports.kind.${report.kind}`), meters })}
          </Text>
          <Text style={styles.nearbyQuestion}>{t('reports.stillThere')}</Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <MaterialCommunityIcons name="close" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.btn, styles.btnCompact, styles.btnPrimary, styles.flex]}
          onPress={() => onVote(true)}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.btnPrimaryText}>{t('reports.yes')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnCompact, styles.btnSecondary, styles.flex]}
          onPress={() => onVote(false)}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.btnSecondaryText}>{t('reports.no')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

/** Bandeau bref sous le titre : « Merci ! », « Trop de signalements… ». */
export const ReportNotice = ({ text, top }: { text: string; top: number }) => (
  <View style={[styles.notice, { top }]} pointerEvents="none">
    <Text style={styles.noticeText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },

  pin: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...elevation.floating.shadow,
  },

  fab: {
    position: 'absolute',
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: REPORT_FAB_HEIGHT,
    paddingHorizontal: space.lg,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    ...elevation.floating.shadow,
  },
  fabText: { color: colors.onPrimary, fontSize: 15, fontWeight: '800' },

  title: { color: colors.textMain, fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: colors.textMuted, fontSize: 15, marginTop: space.xs },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: space.xl, rowGap: space.lg },
  kind: { width: '33.33%', alignItems: 'center', gap: space.sm },
  kindIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faded: { opacity: 0.4 },
  kindLabel: { color: colors.textMain, fontSize: 14, fontWeight: '700' },

  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  headIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  question: { color: colors.textMain, fontSize: 18, fontWeight: '700', marginTop: space.xl },
  note: { color: colors.textMuted, fontSize: 15, lineHeight: 22, marginTop: space.xl },

  btnRow: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    borderRadius: radius.md,
  },
  btnSolo: { marginTop: space.lg },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' },
  btnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  btnSecondaryText: { color: colors.textMain, fontSize: 16, fontWeight: '700' },

  btnCompact: { paddingVertical: space.md },

  nearby: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(10,18,14,0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    ...elevation.floating.shadow,
  },
  nearbyIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyTitle: { color: colors.textMain, fontSize: 16, fontWeight: '800' },
  nearbyQuestion: { color: colors.textMuted, fontSize: 14, marginTop: 2 },

  notice: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.full,
    backgroundColor: 'rgba(10,18,14,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    ...elevation.floating.shadow,
  },
  noticeText: { color: colors.textMain, fontSize: 14, fontWeight: '700' },
});
