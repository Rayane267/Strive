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
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { APP_VERSION_LABEL } from '../utils/appVersion';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SUPPORT_EMAIL = 'contact@striveapp.fr';

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11'] as const;

const HelpScreen = () => {
  const { t } = useTranslation();
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

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t('help.title')}</Text>
          <Text style={styles.headerSub}>{t('help.subtitle')}</Text>
        </View>
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
        <Text style={[styles.sectionLabel, { marginTop: 8 }]}>{t('help.contactTitle')}</Text>

        <View style={styles.contactCard}>
          <View style={styles.contactIconWrap}>
            <MaterialCommunityIcons name="headset" size={28} color={colors.primaryInk} />
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
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { color: colors.textMain, fontSize: 17, fontWeight: '800' },
  headerSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },

  sectionLabel: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 12,
  },

  faqCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    marginBottom: 28,
  },
  faqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 12,
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
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  faqDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: 18,
  },

  contactCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.12)',
    gap: 12,
  },
  contactIconWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(0,230,118,0.1)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.2)',
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
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 4,
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
