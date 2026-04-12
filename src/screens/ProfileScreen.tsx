import React, { useState } from 'react';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { colors } from '../theme/colors';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import AvatarView from '../components/AvatarView';

const ProfileScreen = () => {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const tabBarHeight = useBottomTabBarHeight();
  const { profile } = useAuth();
  const [isLogoutModalVisible, setIsLogoutModalVisible] = useState(false);

  const tier = profile?.subscription_tier?.toLowerCase();
  const isPlus = tier === 'plus' || tier === 'pro' || tier === 'premium';

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  const confirmLogout = async () => {
    setIsLogoutModalVisible(false);
    try {
      await GoogleSignin.signOut();
    } catch (e) {
      __DEV__ && console.log('Google SignOut error:', e);
    }
    const { error } = await supabase.auth.signOut();
    if (error) __DEV__ && console.error(error.message);
  };

  const MENU_ITEMS = [
    {
      icon: 'account-outline',
      iconLib: 'mc',
      title: t('profile.account'),
      sub: t('profile.accountSub'),
      onPress: () => navigation.navigate('AccountInfo'),
      accent: false,
    },
    {
      icon: 'car-outline',
      iconLib: 'mc',
      title: t('profile.car'),
      sub: t('profile.carSub'),
      onPress: () => navigation.navigate('CarSettings'),
      accent: false,
    },
    {
      icon: 'tune-vertical',
      iconLib: 'mc',
      title: t('preferences.title'),
      sub: t('preferences.subtitle'),
      onPress: () => navigation.navigate('Preferences'),
      accent: false,
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('profile.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 16 }]} showsVerticalScrollIndicator={false}>

        {/* ── PROFILE CARD ── */}
        <View style={styles.profileCard}>
          {Platform.OS === 'ios' ? (
            <>
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType="chromeMaterialDark"
                blurAmount={28}
                reducedTransparencyFallbackColor="#0F2D1F"
              />
              <View style={[StyleSheet.absoluteFill, styles.profileGlassTint]} />
            </>
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0F2D1F' }]} />
          )}
          {/* shimmer line */}
          <View style={styles.profileShimmer} />
          {/* Decorative glow for Plus */}
          {isPlus && <View style={styles.plusGlow} />}

          <View style={styles.avatarContainer}>
            <AvatarView
              avatarId="generic"
              size={84}
              borderColor={colors.primary}
            />
          </View>

          <Text style={styles.userName}>
            {profile?.first_name
              ? `${profile.first_name} ${profile.last_name ?? ''}`.trim()
              : t('dashboard.greetingDefault')}
          </Text>

          {isPlus ? (
            <View style={styles.tierBadgePlus}>
              <MaterialCommunityIcons name="crown" size={12} color={colors.background} />
              <Text style={styles.tierBadgePlusText}>PLUS</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.upgradeRow}
              onPress={() => navigation.navigate('SubscriptionScreen')}
            >
              <Text style={styles.freeText}>{t('profile.free')}</Text>
              <Text style={styles.upgradeLink}> · {t('profile.upgradeLink')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── GENERAL SECTION ── */}
        <Text style={styles.sectionTitle}>{t('profile.general')}</Text>

        {MENU_ITEMS.map((item, i) => (
          <TouchableOpacity key={i} style={styles.menuItem} onPress={item.onPress}>
            <View style={styles.menuIconWrap}>
              <MaterialCommunityIcons name={item.icon as any} size={20} color={colors.textMuted} />
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>{item.title}</Text>
              <Text style={styles.menuSub}>{item.sub}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textDimmed} />
          </TouchableOpacity>
        ))}

        {/* ── RESOURCES ── */}
        <Text style={[styles.sectionTitle, { marginTop: 10 }]}>{t('profile.resources')}</Text>

        <TouchableOpacity style={styles.menuItemHighlight} onPress={() => navigation.navigate('Tutorial')}>
          <View style={styles.highlightBar} />
          <View style={styles.menuIconWrapGreen}>
            <MaterialCommunityIcons name="school-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.menuText}>
            <Text style={styles.menuTitle}>{t('profile.tutorial')}</Text>
            <Text style={[styles.menuSub, { color: colors.primary }]}>{t('profile.tutorialSub')}</Text>
          </View>
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Help')}>
          <View style={styles.menuIconWrap}>
            <Feather name="help-circle" size={20} color={colors.textMuted} />
          </View>
          <View style={styles.menuText}>
            <Text style={styles.menuTitle}>{t('profile.help')}</Text>
            <Text style={styles.menuSub}>{t('profile.helpSub')}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textDimmed} />
        </TouchableOpacity>

        {/* ── LANGUAGE ── */}
        <Text style={[styles.sectionTitle, { marginTop: 10 }]}>{t('profile.language')}</Text>

        <View style={styles.langRow}>
          <TouchableOpacity
            style={[styles.langBtn, i18n.language === 'en' && styles.langBtnActive]}
            onPress={() => changeLanguage('en')}
          >
            <Text style={styles.langBtnText}>🇬🇧 English</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, i18n.language === 'fr' && styles.langBtnActive]}
            onPress={() => changeLanguage('fr')}
          >
            <Text style={styles.langBtnText}>🇫🇷 Français</Text>
          </TouchableOpacity>
        </View>

        {/* ── LOGOUT ── */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => setIsLogoutModalVisible(true)}
        >
          <Feather name="log-out" size={18} color={colors.danger} />
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>v2.4.1 (Build 204)</Text>

      </ScrollView>

      {/* ── LOGOUT MODAL ── */}
      <Modal
        animationType="fade"
        transparent
        visible={isLogoutModalVisible}
        onRequestClose={() => setIsLogoutModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Feather name="log-out" size={26} color={colors.danger} />
            </View>
            <Text style={styles.modalTitle}>{t('profile.logoutModal.title')}</Text>
            <Text style={styles.modalMessage}>{t('profile.logoutModal.message')}</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setIsLogoutModalVisible(false)}
              >
                <Text style={styles.modalBtnCancelText}>{t('profile.logoutModal.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={confirmLogout}
              >
                <Text style={styles.modalBtnConfirmText}>{t('profile.logoutModal.confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: { paddingHorizontal: 20, paddingVertical: 15 },
  headerTitle: { color: colors.textMain, fontSize: 24, fontWeight: 'bold' },

  scrollContent: { paddingHorizontal: 20 },

  // Profile card
  profileCard: {
    borderRadius: 24,
    padding: 28,
    marginBottom: 28,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,230,118,0.28)',
    overflow: 'hidden',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  profileGlassTint: {
    backgroundColor: 'rgba(0, 230, 118, 0.06)',
  },
  profileShimmer: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: 'rgba(0,230,118,0.32)',
    borderRadius: 1,
  },
  plusGlow: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(0,230,118,0.07)',
  },
  avatarContainer: { position: 'relative', marginBottom: 14 },
  avatarRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarRingPlus: { borderColor: colors.primary },
  avatarImage: { width: 90, height: 90, borderRadius: 45 },
  editBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: colors.primary,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  userName: {
    color: colors.textMain,
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  tierBadgePlus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  tierBadgePlusText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  upgradeRow: { flexDirection: 'row', alignItems: 'center' },
  freeText: { color: colors.textMuted, fontSize: 14 },
  upgradeLink: { color: colors.primary, fontSize: 14, fontWeight: '600' },

  // Section title
  sectionTitle: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginTop: 4,
    textTransform: 'uppercase',
  },

  // Menu items
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 15,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  menuItemHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    padding: 15,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.2)',
    overflow: 'hidden',
    position: 'relative',
  },
  highlightBar: {
    position: 'absolute',
    left: 0,
    top: 12,
    bottom: 12,
    width: 3,
    backgroundColor: colors.primary,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  menuIconWrap: {
    width: 38,
    height: 38,
    backgroundColor: colors.surfaceLight,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuIconWrapGreen: {
    width: 38,
    height: 38,
    backgroundColor: 'rgba(0,230,118,0.1)',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuText: { flex: 1 },
  menuTitle: { color: colors.textMain, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  menuSub: { color: colors.textDimmed, fontSize: 12 },
  newBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginRight: 4,
  },
  newBadgeText: { color: colors.background, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  // Language
  langRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  langBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  langBtnActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(0,230,118,0.08)',
  },
  langBtnText: { color: colors.textMain, fontSize: 15, fontWeight: '600' },

  // Logout
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.25)',
    padding: 15,
    borderRadius: 16,
    marginBottom: 20,
  },
  logoutText: { color: colors.danger, fontSize: 15, fontWeight: '600' },

  versionText: { textAlign: 'center', color: colors.textDimmed, fontSize: 11, marginBottom: 10 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    width: '100%',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  modalIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,77,77,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { color: colors.textMain, fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  modalMessage: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalBtnCancel: { backgroundColor: colors.surfaceLight },
  modalBtnConfirm: { backgroundColor: colors.danger },
  modalBtnCancelText: { color: colors.textMain, fontSize: 14, fontWeight: '600' },
  modalBtnConfirmText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});

export default ProfileScreen;
