import React, { useState } from 'react';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SafeGradient from '../components/SafeGradient';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { colors } from '../theme/colors';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import AvatarView from '../components/AvatarView';

type MenuItem = {
  icon: string;
  iconLib?: 'feather' | 'mc';
  title: string;
  sub?: string;
  onPress: () => void;
  badge?: string;
  accent?: boolean;
};

const ProfileScreen = () => {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const tabBarHeight = useBottomTabBarHeight();
  const { profile, user } = useAuth();
  const [isLogoutModalVisible, setIsLogoutModalVisible] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  const tier = profile?.subscription_tier?.toLowerCase();
  const isPlus = tier === 'plus' || tier === 'pro' || tier === 'premium';

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    if (Platform.OS === 'ios') {
      const { NativeModules } = require('react-native');
      NativeModules.ScanBridge?.setAppLanguage(lang);
    }
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

  const confirmDeleteAccount = async () => {
    if (deleteConfirmation.trim().toUpperCase() !== 'SUPPRIMER' &&
        deleteConfirmation.trim().toUpperCase() !== 'DELETE') {
      Alert.alert(
        t('profile.deleteModal.errorTitle', 'Confirmation requise'),
        t('profile.deleteModal.errorMessage', 'Tapez "SUPPRIMER" pour confirmer.'),
      );
      return;
    }
    setDeleting(true);
    try {
      // RGPD : purge l'avatar du Storage AVANT delete_account (après, plus de
      // session pour le faire ; un DELETE SQL sur storage.objects laisserait
      // le fichier orphelin côté S3). Best-effort : un échec ne bloque pas la
      // suppression du compte.
      if (user?.id) {
        try {
          const { data: files } = await supabase.storage.from('avatars').list(user.id);
          if (files && files.length > 0) {
            await supabase.storage
              .from('avatars')
              .remove(files.map(f => `${user.id}/${f.name}`));
          }
        } catch {}
      }
      const { error } = await supabase.rpc('delete_account');
      if (error) throw error;
      try { await GoogleSignin.signOut(); } catch {}
      await supabase.auth.signOut();
    } catch (e: any) {
      Alert.alert(
        t('profile.deleteModal.errorTitle', 'Erreur'),
        e?.message ?? t('profile.deleteModal.errorGeneric', 'Suppression impossible. Réessayez ou contactez le support.'),
      );
    } finally {
      setDeleting(false);
      setIsDeleteModalVisible(false);
      setDeleteConfirmation('');
    }
  };

  const accountItems: MenuItem[] = [
    {
      icon: 'account-outline',
      iconLib: 'mc',
      title: t('profile.account'),
      sub: t('profile.accountSub'),
      onPress: () => navigation.navigate('AccountInfo'),
    },
    {
      icon: 'car-outline',
      iconLib: 'mc',
      title: t('profile.car'),
      sub: t('profile.carSub'),
      onPress: () => navigation.navigate('CarSettings'),
    },
    {
      icon: 'tune-vertical',
      iconLib: 'mc',
      title: t('preferences.title'),
      sub: t('preferences.subtitle'),
      onPress: () => navigation.navigate('Preferences'),
    },
    ...(isPlus ? [{
      icon: 'crown-outline',
      iconLib: 'mc' as const,
      title: t('subscription.manage', 'Gérer mon abonnement'),
      sub: t('profile.subscriptionSubActive', 'Annuler, changer de formule...'),
      onPress: () => navigation.navigate('SubscriptionScreen'),
    }] : []),
  ];

  const resourceItems: MenuItem[] = [
    {
      icon: 'school-outline',
      iconLib: 'mc',
      title: t('profile.tutorial'),
      sub: t('profile.tutorialSub'),
      onPress: () => navigation.navigate('Tutorial'),
      badge: 'NEW',
      accent: true,
    },
    {
      icon: 'help-circle',
      iconLib: 'feather',
      title: t('profile.help'),
      sub: t('profile.helpSub'),
      onPress: () => navigation.navigate('Help'),
    },
  ];

  const renderIcon = (item: MenuItem) => {
    const color = item.accent ? colors.primary : colors.textMuted;
    if (item.iconLib === 'feather') {
      return <Feather name={item.icon as any} size={20} color={color} />;
    }
    return <MaterialCommunityIcons name={item.icon as any} size={20} color={color} />;
  };

  const renderMenuGroup = (items: MenuItem[]) => (
    <View style={styles.menuGroup}>
      {items.map((item, i) => (
        <TouchableOpacity
          key={i}
          style={[styles.menuRow, i < items.length - 1 && styles.menuRowDivider]}
          onPress={item.onPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={item.title}
        >
          <View style={[styles.menuIconWrap, item.accent && styles.menuIconWrapAccent]}>
            {renderIcon(item)}
          </View>
          <View style={styles.menuText}>
            <Text style={[styles.menuTitle, item.accent && { color: colors.textMain }]} numberOfLines={1}>
              {item.title}
            </Text>
            {item.sub ? (
              <Text style={[styles.menuSub, item.accent && { color: colors.primary }]} numberOfLines={1}>
                {item.sub}
              </Text>
            ) : null}
          </View>
          {item.badge ? (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>{item.badge}</Text>
            </View>
          ) : (
            <Feather name="chevron-right" size={18} color={colors.textDimmed} />
          )}
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('profile.title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── PROFILE CARD ── */}
        <SafeGradient
          colors={['#0F2D1F', '#0A150E']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileCard}
        >
          <View style={styles.profileContent}>
            {isPlus && <View style={styles.plusGlow} />}
            <View style={styles.profileShimmer} />

            <View style={styles.avatarContainer}>
              <AvatarView
                avatarId="generic"
                size={84}
                borderColor={colors.primary}
              />
            </View>

            <Text style={styles.userName} numberOfLines={1}>
              {profile?.first_name
                ? `${profile.first_name} ${profile.last_name ?? ''}`.trim()
                : t('dashboard.greetingDefault')}
            </Text>

            {user?.email ? (
              <Text style={styles.userEmail} numberOfLines={1}>{user.email}</Text>
            ) : null}

            {isPlus ? (
              <View style={styles.tierBadgePlus}>
                <MaterialCommunityIcons name="crown" size={12} color={colors.background} />
                <Text style={styles.tierBadgePlusText}>{t('tier.plusBadge')}</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.upgradeBtnWrap}
                onPress={() => navigation.navigate('SubscriptionScreen')}
                activeOpacity={0.85}
              >
                <SafeGradient
                  colors={['#A4FF6B', '#00FF8C', colors.primary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.upgradeBtn}
                >
                  <MaterialCommunityIcons name="crown" size={14} color="#062318" />
                  <Text style={styles.upgradeBtnText}>{t('profile.upgradeLink')}</Text>
                </SafeGradient>
              </TouchableOpacity>
            )}
          </View>
        </SafeGradient>

        {/* ── ACCOUNT SECTION ── */}
        <Text style={styles.sectionTitle}>{t('profile.general')}</Text>
        {renderMenuGroup(accountItems)}

        {/* ── UPGRADE CTA (free only) ── */}
        {!isPlus && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate('SubscriptionScreen')}
            style={styles.profileUpgradeCard}
          >
            <SafeGradient
              colors={['#0A2418', '#0E3020', '#122E1E']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.profileUpgradeGradient}
            >
              <View style={styles.profileUpgradeGlow} />
              <View style={styles.profileUpgradeRow}>
                <SafeGradient
                  colors={['#A4FF6B', '#00FF8C', colors.primary]}
                  style={styles.profileUpgradeIconWrap}
                >
                  <MaterialCommunityIcons name="crown" size={18} color="#062318" />
                </SafeGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileUpgradeTitle}>{t('profile.upgradeCardTitle')}</Text>
                  <Text style={styles.profileUpgradeSub}>{t('profile.upgradeCardSub')}</Text>
                </View>
                <Feather name="arrow-right" size={18} color={colors.primary} />
              </View>
            </SafeGradient>
          </TouchableOpacity>
        )}

        {/* ── RESOURCES SECTION ── */}
        <Text style={[styles.sectionTitle, !isPlus ? {} : { marginTop: 22 }]}>{t('profile.resources')}</Text>
        {renderMenuGroup(resourceItems)}

        {/* ── LANGUAGE SECTION ── */}
        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>{t('profile.language')}</Text>
        <View style={styles.langRow}>
          <TouchableOpacity
            style={[styles.langBtn, i18n.language === 'en' && styles.langBtnActive]}
            onPress={() => changeLanguage('en')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="English"
            accessibilityState={{ selected: i18n.language === 'en' }}
          >
            <Text style={styles.langFlag}>🇬🇧</Text>
            <Text style={[styles.langBtnText, i18n.language === 'en' && styles.langBtnTextActive]}>English</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, i18n.language === 'fr' && styles.langBtnActive]}
            onPress={() => changeLanguage('fr')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Français"
            accessibilityState={{ selected: i18n.language === 'fr' }}
          >
            <Text style={styles.langFlag}>🇫🇷</Text>
            <Text style={[styles.langBtnText, i18n.language === 'fr' && styles.langBtnTextActive]}>Français</Text>
          </TouchableOpacity>
        </View>

        {/* ── DANGER ZONE ── */}
        <View style={[styles.dangerGroup, { marginTop: 22 }]}>
          <TouchableOpacity
            style={[styles.menuRow, styles.menuRowDivider]}
            onPress={() => setIsLogoutModalVisible(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('profile.logout')}
          >
            <View style={styles.menuIconWrapDanger}>
              <Feather name="log-out" size={20} color={colors.danger} />
            </View>
            <View style={styles.menuText}>
              <Text style={[styles.menuTitle, { color: colors.danger }]}>{t('profile.logout')}</Text>
              <Text style={styles.menuSub}>{t('profile.logoutModal.message')}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textDimmed} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setIsDeleteModalVisible(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('profile.deleteAccount', 'Supprimer mon compte')}
          >
            <View style={styles.menuIconWrapDanger}>
              <Feather name="trash-2" size={20} color={colors.danger} />
            </View>
            <View style={styles.menuText}>
              <Text style={[styles.menuTitle, { color: colors.danger }]}>
                {t('profile.deleteAccount', 'Supprimer mon compte')}
              </Text>
              <Text style={styles.menuSub}>
                {t('profile.deleteAccountSub', 'Action irréversible')}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textDimmed} />
          </TouchableOpacity>
        </View>

        {/* ── FOOTER ── */}
        <View style={styles.legalLinksRow}>
          <TouchableOpacity onPress={() => Linking.openURL('https://strive.app/privacy')}>
            <Text style={styles.legalLink}>{t('profile.privacy', 'Confidentialité')}</Text>
          </TouchableOpacity>
          <Text style={styles.legalSep}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://strive.app/terms')}>
            <Text style={styles.legalLink}>{t('profile.terms', 'CGU')}</Text>
          </TouchableOpacity>
        </View>
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

      {/* ── DELETE ACCOUNT MODAL ── */}
      <Modal
        animationType="fade"
        transparent
        visible={isDeleteModalVisible}
        onRequestClose={() => { setIsDeleteModalVisible(false); setDeleteConfirmation(''); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={[styles.modalIconWrap, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
              <Feather name="alert-triangle" size={26} color={colors.danger} />
            </View>
            <Text style={styles.modalTitle}>{t('profile.deleteModal.title', 'Supprimer le compte ?')}</Text>
            <Text style={styles.modalMessage}>
              {t('profile.deleteModal.message', 'Action irréversible : compte, préférences et historique des courses seront définitivement supprimés.')}
            </Text>
            <TextInput
              style={styles.deleteInput}
              placeholder={t('profile.deleteModal.placeholder', 'Tapez SUPPRIMER')}
              placeholderTextColor={colors.textDimmed}
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => { setIsDeleteModalVisible(false); setDeleteConfirmation(''); }}
                disabled={deleting}
              >
                <Text style={styles.modalBtnCancelText}>{t('profile.logoutModal.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm, deleting && { opacity: 0.6 }]}
                onPress={confirmDeleteAccount}
                disabled={deleting}
              >
                <Text style={styles.modalBtnConfirmText}>
                  {deleting ? '…' : t('profile.deleteModal.confirm', 'Supprimer')}
                </Text>
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

  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { color: colors.textMain, fontSize: 28, fontWeight: '900' },

  scrollContent: { paddingHorizontal: 20 },

  // Profile card
  profileCard: {
    borderRadius: 24,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.18)',
    overflow: 'hidden',
  },
  profileContent: {
    padding: 24,
    alignItems: 'center',
  },
  profileShimmer: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: 'rgba(0,230,118,0.32)',
  },
  plusGlow: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(0,230,118,0.08)',
  },
  avatarContainer: { marginBottom: 14 },
  userName: {
    color: colors.textMain,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  userEmail: {
    color: colors.textDimmed,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 14,
  },
  tierBadgePlus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    marginTop: 4,
  },
  tierBadgePlusText: {
    color: colors.background,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  upgradeBtnWrap: {
    marginTop: 8,
    borderRadius: 22, overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#00FF8C', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10 },
      android: { elevation: 8 },
    }),
  },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 22,
  },
  upgradeBtnText: { color: '#062318', fontSize: 13, fontWeight: '900', letterSpacing: 0.3 },

  // Upgrade CTA card
  profileUpgradeCard: {
    marginTop: 18, marginBottom: 18, borderRadius: 18, overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#00E676', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14 },
      android: { elevation: 8 },
    }),
  },
  profileUpgradeGradient: {
    borderRadius: 18, padding: 18,
    borderWidth: 1.5, borderColor: 'rgba(0,230,118,0.25)',
    overflow: 'hidden',
  },
  profileUpgradeGlow: {
    position: 'absolute', top: -20, right: -20,
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(0,230,118,0.08)',
  },
  profileUpgradeRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  profileUpgradeIconWrap: {
    width: 42, height: 42, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#00FF8C', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.6, shadowRadius: 8 },
      android: { elevation: 6 },
    }),
  },
  profileUpgradeTitle: { color: colors.textMain, fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  profileUpgradeSub: { color: colors.textMuted, fontSize: 12, marginTop: 3, lineHeight: 16 },

  // Section title
  sectionTitle: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  dangerSectionTitle: { color: colors.danger, opacity: 0.7 },

  // Menu group (iOS settings-like card)
  menuGroup: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  dangerGroup: {
    backgroundColor: 'rgba(255,77,77,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.18)',
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  menuRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  menuIconWrap: {
    width: 38,
    height: 38,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuIconWrapAccent: {
    backgroundColor: 'rgba(0,230,118,0.1)',
  },
  menuIconWrapDanger: {
    width: 38,
    height: 38,
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuText: { flex: 1 },
  menuTitle: { color: colors.textMain, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  menuSub: { color: colors.textDimmed, fontSize: 12, fontWeight: '500' },
  newBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  newBadgeText: { color: colors.background, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  // Language
  langRow: { flexDirection: 'row', gap: 10 },
  langBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  langBtnActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(0,230,118,0.08)',
  },
  langFlag: { fontSize: 18 },
  langBtnText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  langBtnTextActive: { color: colors.textMain },

  // Footer
  legalLinksRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 28,
    marginBottom: 8,
  },
  legalLink: { color: colors.textDimmed, fontSize: 11, textDecorationLine: 'underline' },
  legalSep: { color: colors.textDimmed, fontSize: 11 },
  versionText: { textAlign: 'center', color: colors.textDimmed, fontSize: 11, marginBottom: 10 },

  deleteInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textMain,
    backgroundColor: 'rgba(239,68,68,0.05)',
    marginBottom: 16,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },

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
