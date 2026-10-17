import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { elevation } from '../theme/elevation';
import { FIELD_TOP } from '../theme/field';
import ScreenField from '../components/ScreenField';
import AnimatedEntrance from '../components/AnimatedEntrance';
import { APP_VERSION } from '../utils/appVersion';
import { openStoreForUpdate } from '../services/appReleaseService';

type Props = {
  latest: string;
  /** Nouveautés dans la langue du chauffeur ; la carte disparaît si vide. */
  notes: string[];
  onLater: () => void;
};

/**
 * « Mise à jour disponible », à l'ouverture de l'app (cf. RootNavigator).
 * Toujours ignorable : la mise à jour est proposée, jamais imposée.
 *
 * Un seul focal : le titre. La version installée et la nouvelle se lisent dans
 * une pilule discrète, les nouveautés dans une carte, et le seul aplat vert de
 * l'écran est le bouton — c'est le geste attendu.
 */
const UpdateScreen = ({ latest, notes, onLater }: Props) => {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenField />

      <View style={styles.body}>
        <AnimatedEntrance step={0} focal>
          <View style={styles.badge}>
            <Feather name="arrow-up" size={30} color={colors.textMain} />
          </View>
          <Text style={styles.title}>{t('update.title', 'Mise à jour disponible')}</Text>
          <Text style={styles.subtitle}>
            {t('update.body', {
              version: latest,
              defaultValue: 'La version {{version}} de Strive est disponible. Installez-la pour profiter des dernières corrections.',
            })}
          </Text>
          <View style={styles.versions}>
            <Text style={styles.versionOld}>v{APP_VERSION}</Text>
            <Feather name="arrow-right" size={13} color={colors.textDimmed} />
            <Text style={styles.versionNew}>v{latest}</Text>
          </View>
        </AnimatedEntrance>

        {notes.length > 0 && (
          <AnimatedEntrance step={1}>
            <View style={styles.notes}>
              <Text style={styles.notesTitle}>{t('update.whatsNew', 'Nouveautés')}</Text>
              {notes.map((note, i) => (
                <View key={i} style={styles.noteRow}>
                  <View style={styles.noteDot} />
                  <Text style={styles.noteText}>{note}</Text>
                </View>
              ))}
            </View>
          </AnimatedEntrance>
        )}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.cta} onPress={openStoreForUpdate} activeOpacity={0.85}>
          <Text style={styles.ctaText}>{t('update.cta', 'Mettre à jour')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.later} onPress={onLater}>
          <Text style={styles.laterText}>{t('update.later', 'Plus tard')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FIELD_TOP },

  body: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xl },

  badge: {
    alignSelf: 'center',
    width: 72, height: 72, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: strokeWidth.surface, borderColor: stroke.edge,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space.xl,
  },
  title: {
    color: colors.textMain, fontSize: 26, fontWeight: '800',
    textAlign: 'center', marginBottom: space.sm,
  },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: 'center' },

  versions: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: space.sm,
    marginTop: space.lg,
    paddingHorizontal: space.md, paddingVertical: space.xs,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  versionOld: { color: colors.textDimmed, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  versionNew: { color: colors.textMain, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },

  notes: {
    marginTop: space.xl,
    padding: space.lg,
    gap: space.sm,
    borderRadius: radius.lg,
    backgroundColor: elevation.resting.surface,
    borderWidth: strokeWidth.surface, borderColor: stroke.edge,
    ...elevation.resting.shadow,
  },
  notesTitle: {
    color: colors.textMuted, fontSize: 12, fontWeight: '700',
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: space.xs,
  },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  noteDot: {
    width: 5, height: 5, borderRadius: radius.full,
    backgroundColor: colors.primary, marginTop: space.sm,
  },
  noteText: { flex: 1, color: colors.textMain, fontSize: 14, lineHeight: 20 },

  footer: { paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.sm },
  cta: {
    height: 56, borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    ...elevation.raised.shadow,
  },
  ctaText: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' },
  later: { height: 48, alignItems: 'center', justifyContent: 'center' },
  laterText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
});

export default UpdateScreen;
