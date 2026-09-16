import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useMarketT } from '../hooks/useMarketT';
import { colors } from '../theme/colors';
import { APP_VERSION_LABEL } from '../utils/appVersion';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { FIELD_TOP } from '../theme/field';
import ScreenField from '../components/ScreenField';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SUPPORT_EMAIL = 'contact@striveapp.fr';

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11'] as const;

const HelpScreen = () => {
  // Les questions sont interrogées par clef construite : la devise ne peut
  // pas être passée question par question.
  const { t } = useMarketT();
  const navigation = useNavigation<any>();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const toggle = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenKey(prev => (prev === key ? null : key));
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(t('help.mailSubject', 'Support Strive'));
    // Contexte technique pré-rempli pour accélérer le diagnostic côté support.
    const body = encodeURIComponent(
      `\n\n———\n${t('help.mailContext', 'Infos techniques (ne pas supprimer)')}\n` +
        `App : Strive ${APP_VERSION_LABEL}\n` +
        `OS : ${Platform.OS} ${Platform.Version}\n`,
    );
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Pose en premier, donc derriere tout le reste. Il remplit la zone SOUS
          l'encoche, et `container` porte la meme couleur que son sommet : la
          bande de statut se confond avec lui au lieu de faire un bandeau. */}
      <ScreenField />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="chevron-left" size={30} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('help.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* FAQ */}
        <Text style={styles.sectionLabel}>{t('help.faqTitle')}</Text>

        <View style={styles.faqCard}>
          {FAQ_KEYS.map((key, index) => {
            const isOpen = openKey === key;
            const isLast = index === FAQ_KEYS.length - 1;
            return (
              <View key={key}>
                <TouchableOpacity
                  style={styles.faqRow}
                  onPress={() => toggle(key)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.faqQuestion}>{t(`help.faq.${key}`)}</Text>
                  <Feather
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={isOpen ? colors.primary : colors.textDimmed}
                  />
                </TouchableOpacity>
                {isOpen && (
                  <Text style={styles.faqAnswer}>
                    {t(`help.faq.${key.replace('q', 'a')}`)}
                  </Text>
                )}
                {!isLast && <View style={styles.faqDivider} />}
              </View>
            );
          })}
        </View>

        {/* Contact */}
        <Text style={[styles.sectionLabel, { marginTop: space.sm }]}>{t('help.contactTitle')}</Text>

        <View style={styles.contactCard}>
          <View style={styles.contactIconWrap}>
            <MaterialCommunityIcons name="headset" size={28} color={colors.primary} />
          </View>
          <Text style={styles.contactDesc}>{t('help.contactDesc')}</Text>
          <TouchableOpacity style={styles.contactBtn} onPress={handleEmail} activeOpacity={0.85}>
            <Feather name="mail" size={16} color={colors.background} />
            <Text style={styles.contactBtnText}>{t('help.contactBtn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleEmail} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.contactEmail}>{SUPPORT_EMAIL}</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FIELD_TOP },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  backBtn: {
    marginLeft: -10,
    width: 44, height: 44,
    justifyContent: 'center', alignItems: 'center',
  },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: {
    marginRight: space.md,
    flex: 1, color: colors.textMain, fontSize: 26, fontWeight: '800' },
  headerSub: { color: colors.textMuted, fontSize: 12, marginTop: space.tight },

  scroll: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.xxl },

  sectionLabel: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: space.md,
  },

  faqCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    overflow: 'hidden',
    marginBottom: space.xl,
  },
  faqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.md,
  },
  faqQuestion: {
    color: colors.textMain,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    lineHeight: 20,
  },
  faqAnswer: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
  faqDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: space.lg,
  },

  contactCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    gap: space.md,
  },
  contactIconWrap: {
    width: 60, height: 60, borderRadius: radius.full,
    backgroundColor: 'rgba(0,230,118,0.1)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
  },
  contactDesc: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.sm,
    marginTop: space.xs,
  },
  contactBtnText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '800',
  },
  contactEmail: {
    color: colors.textDimmed,
    fontSize: 12,
  },
});

export default HelpScreen;
