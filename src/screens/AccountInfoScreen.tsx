import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  KeyboardTypeOptions,
  Alert,
} from 'react-native';
import { Toast, useToast } from '../components/Toast';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { getEffectivePlanTier } from '../services/subscriptionService';
import { colors } from '../theme/colors';

import AvatarView from '../components/AvatarView';
import BrandLoader from '../components/BrandLoader';
import { hapticSuccess, hapticError } from '../utils/haptics';

interface InputFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  icon: string;
  iconFamily?: 'Feather' | 'MaterialCommunityIcons';
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  editable?: boolean;
}

// Défini au niveau module : redéfinir ce composant à l'intérieur de l'écran
// changeait son identité à chaque frappe → React démontait/remontait le TextInput
// → le clavier se refermait à chaque caractère.
const InputField = ({
  label,
  value,
  onChangeText,
  icon,
  iconFamily = 'Feather',
  placeholder,
  keyboardType = 'default',
  editable = true,
  error,
}: InputFieldProps & { error?: string }) => {
  const IconComponent = iconFamily === 'MaterialCommunityIcons' ? MaterialCommunityIcons : Feather;
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={[styles.inputContainer, !editable && styles.inputDisabled, !!error && styles.inputError]}>
        <IconComponent
          name={icon}
          size={18}
          color={error ? colors.danger : editable ? colors.primary : colors.textMuted}
          style={styles.inputIcon}
        />
        <TextInput
          style={[styles.input, !editable && { color: colors.textMuted }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textDimmed}
          keyboardType={keyboardType}
          editable={editable}
        />
      </View>
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
};

const AccountInfoScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { user, profile, refreshProfile } = useAuth();

  const isPremium = getEffectivePlanTier(profile) !== 'free';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'error' | 'success' | null }>({ text: '', type: null });
  const { toast, showToast, dismissToast } = useToast();

  const handleDeleteHistory = () => {
    if (!user?.id) return;
    Alert.alert(
      t('accountInfo.deleteHistory.title', 'Supprimer mon historique'),
      t('accountInfo.deleteHistory.message', 'Toutes vos courses enregistrées (adresses, tarifs, statistiques) seront définitivement supprimées. Cette action est irréversible.'),
      [
        { text: t('common.cancel', 'Annuler'), style: 'cancel' },
        {
          text: t('accountInfo.deleteHistory.confirm', 'Supprimer'),
          style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            setDeletingHistory(true);
            try {
              const { error } = await supabase.from('rides').delete().eq('user_id', user.id);
              if (error) throw error;
              hapticSuccess();
              showToast({ type: 'success', title: t('common.success'), message: t('accountInfo.deleteHistory.success', 'Historique supprimé.') });
            } catch (e) {
              hapticError();
              showToast({ type: 'error', title: t('common.error'), message: t('accountInfo.deleteHistory.error', 'Échec de la suppression. Réessayez.') });
              __DEV__ && console.error(e);
            } finally {
              setDeletingHistory(false);
            }
          },
        },
      ],
    );
  };

  const formatPhoneNumber = (text: string) => {
    const cleaned = text.replace(/\s+/g, '');
    return cleaned.replace(/(.{2})(?!$)/g, '$1 ');
  };

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const filterName = (text: string) => text.replace(/[^a-zA-ZÀ-ÿ\s\-']/g, '').slice(0, 40);

  const filterPhone = (text: string) => text.replace(/[^0-9\s\+]/g, '').slice(0, 20);

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!formData.first_name.trim()) errs.first_name = t('profile.setup.errors.firstNameRequired', 'Prénom requis');
    if (!formData.last_name.trim()) errs.last_name = t('profile.setup.errors.lastNameRequired', 'Nom requis');
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errs.email = t('accountInfo.errors.emailInvalid', 'Email invalide');
    }
    const cleanedPhone = formData.phone.replace(/\s+/g, '');
    if (cleanedPhone && (cleanedPhone.length < 6 || cleanedPhone.length > 15 || !/^[\d\+]+$/.test(cleanedPhone))) {
      errs.phone = t('accountInfo.errors.phoneInvalid', 'Numéro de téléphone invalide');
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const [formData, setFormData] = useState({
    first_name:
      user?.user_metadata?.first_name ||
      user?.user_metadata?.name?.split(' ')[0] ||
      '',
    last_name:
      user?.user_metadata?.last_name ||
      user?.user_metadata?.name?.split(' ').slice(1).join(' ') ||
      '',
    phone: formatPhoneNumber(user?.phone || user?.user_metadata?.phone || ''),
    email: user?.email || '',
    avatar_url: user?.user_metadata?.avatar_url || 'preset:m0',
  });

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('first_name, last_name, phone, email, avatar_url')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (profileData) {
        setFormData(prev => ({
          ...prev,
          first_name: profileData.first_name || prev.first_name,
          last_name: profileData.last_name || prev.last_name,
          phone: profileData.phone ? formatPhoneNumber(profileData.phone) : prev.phone,
          email: profileData.email || prev.email,
          avatar_url: profileData.avatar_url || prev.avatar_url,
        }));
      }
    } catch (error) {
      __DEV__ && console.error('Erreur chargement profil:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    if (!user?.id) return;
    if (!validateForm()) return;
    setSaving(true);
    setStatusMessage({ text: '', type: null });
    try {
      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        first_name: formData.first_name,
        last_name: formData.last_name,
        phone: formData.phone,
        avatar_url: formData.avatar_url,
      });
      if (error) throw error;
      if (refreshProfile) await refreshProfile();
      hapticSuccess();
      setStatusMessage({ text: t('carSettings.success.saved', 'Enregistré avec succès.'), type: 'success' });
    } catch (error) {
      hapticError();
      setStatusMessage({ text: t('accountInfo.errorSave', 'Impossible d\'enregistrer. Réessayez.'), type: 'error' });
      __DEV__ && console.error(error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]} edges={['top']}>
        <BrandLoader size={12} />
      </SafeAreaView>
    );
  }

  const fullName = `${formData.first_name} ${formData.last_name}`.trim() || t('accountInfo.driverDefault');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Toast data={toast} onDismiss={dismissToast} bottomOffset={40} />

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('profile.account', 'Mon profil')}</Text>
          <Text style={styles.headerSub}>{t('accountInfo.subtitle', 'Informations personnelles')}</Text>
        </View>
        <View style={[styles.planBadge, isPremium && styles.planBadgePlus]}>
          {isPremium && <MaterialCommunityIcons name="crown" size={11} color={colors.background} style={{ marginRight: 4 }} />}
          <Text style={[styles.planBadgeText, isPremium && styles.planBadgeTextPlus]}>
            {isPremium ? t('tier.plusBadge') : t('tier.freeBadge')}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* ── AVATAR SECTION ── */}
          <View style={styles.avatarSection}>
            <AvatarView avatarId="generic" size={100} borderColor={colors.primary} />
            <Text style={styles.profileName}>{fullName}</Text>
            <View style={styles.verifiedRow}>
              <MaterialCommunityIcons name="check-decagram" size={14} color={colors.primary} />
              <Text style={styles.verifiedText}>{t('profile.verified', 'Chauffeur vérifié')}</Text>
            </View>
          </View>

          {/* ── FORM ── */}
          <View style={styles.formCard}>
            <View style={styles.formHeader}>
              <Feather name="user" size={15} color={colors.primary} />
              <Text style={styles.formHeaderText}>{t('accountInfo.informations')}</Text>
            </View>

            <InputField
              label={t('profile.setup.firstName', 'Prénom')}
              icon="user"
              value={formData.first_name}
              onChangeText={text => { setFormData({ ...formData, first_name: filterName(text) }); setFieldErrors(e => ({ ...e, first_name: '' })); }}
              placeholder={t('profile.setup.placeholderFirstName', 'Jean')}
              error={fieldErrors.first_name}
            />
            <InputField
              label={t('profile.setup.lastName', 'Nom')}
              icon="user"
              value={formData.last_name}
              onChangeText={text => { setFormData({ ...formData, last_name: filterName(text) }); setFieldErrors(e => ({ ...e, last_name: '' })); }}
              placeholder={t('profile.setup.placeholderLastName', 'Dupont')}
              error={fieldErrors.last_name}
            />
            <InputField
              label={t('profile.emailLabel', 'Email')}
              icon="mail"
              value={formData.email}
              onChangeText={() => {}}
              placeholder="name@example.com"
              keyboardType="email-address"
              editable={false}
            />
            <Text style={styles.lockedNote}>
              {t('accountInfo.emailLockedNote', 'Email lié à votre compte Google / Apple — non modifiable.')}
            </Text>
            <InputField
              label={t('profile.phoneLabel', 'Téléphone')}
              icon="phone"
              value={formData.phone}
              onChangeText={text => { setFormData({ ...formData, phone: formatPhoneNumber(filterPhone(text)) }); setFieldErrors(e => ({ ...e, phone: '' })); }}
              placeholder={t('profile.phonePlaceholder', '06 XX XX XX XX')}
              keyboardType="phone-pad"
              error={fieldErrors.phone}
            />
          </View>

          {/* ── DONNÉES & CONFIDENTIALITÉ ── */}
          <View style={[styles.formCard, { marginTop: 18 }]}>
            <View style={styles.formHeader}>
              <Feather name="shield" size={15} color={colors.primary} />
              <Text style={styles.formHeaderText}>{t('accountInfo.privacy', 'DONNÉES & CONFIDENTIALITÉ')}</Text>
            </View>
            <Text style={styles.privacyNote}>
              {t('accountInfo.deleteHistory.note', 'Vos courses (adresses incluses) sont conservées jusqu\'à la suppression de votre compte, puis définitivement effacées.')}
            </Text>
            <TouchableOpacity
              style={styles.deleteHistoryBtn}
              onPress={handleDeleteHistory}
              disabled={deletingHistory}
              activeOpacity={0.85}
            >
              {deletingHistory ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <>
                  <Feather name="trash-2" size={16} color={colors.danger} />
                  <Text style={styles.deleteHistoryText}>{t('accountInfo.deleteHistory.button', 'Supprimer mon historique')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* ── STATUS MESSAGE ── */}
          {statusMessage.text !== '' && (
            <View style={[styles.statusBox, statusMessage.type === 'error' ? styles.statusError : styles.statusSuccess]}>
              <Feather
                name={statusMessage.type === 'error' ? 'alert-circle' : 'check-circle'}
                size={16}
                color={statusMessage.type === 'error' ? colors.danger : colors.primary}
              />
              <Text style={[styles.statusText, { color: statusMessage.type === 'error' ? colors.danger : colors.primary }]}>
                {statusMessage.text}
              </Text>
            </View>
          )}

          {/* ── SAVE BUTTON ── */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <>
                <Feather name="check" size={20} color={colors.background} />
                <Text style={styles.saveBtnText}>{t('preferences.save', 'Enregistrer')}</Text>
              </>
            )}
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  backBtn: {
    width: 38,
    height: 38,
    backgroundColor: colors.surface,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  headerCenter: { flex: 1, marginHorizontal: 14 },
  headerTitle: { color: colors.textMain, fontSize: 17, fontWeight: '800' },
  headerSub: { color: colors.textDimmed, fontSize: 12, marginTop: 2 },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  planBadgePlus: { backgroundColor: colors.primary, borderColor: colors.primary },
  planBadgeText: { color: colors.textDimmed, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  planBadgeTextPlus: { color: colors.background },

  scroll: { paddingHorizontal: 20, paddingBottom: 20 },

  // Avatar section
  avatarSection: { alignItems: 'center', marginTop: 14, marginBottom: 28, gap: 10 },
  profileName: { color: colors.textMain, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  verifiedText: { color: colors.primary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

  // Form card
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  formHeaderText: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },

  inputGroup: { marginBottom: 14 },
  inputLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 7,
    textTransform: 'uppercase',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  inputDisabled: { opacity: 0.5 },
  inputError: { borderColor: colors.danger },
  fieldError: { color: colors.danger, fontSize: 11, fontWeight: '600', marginTop: 4 },
  lockedNote: { color: colors.textMuted, fontSize: 11, marginTop: -8, marginBottom: 14, marginLeft: 2 },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, color: colors.textMain, fontSize: 15, height: '100%' },

  // Données & confidentialité
  privacyNote: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 14 },
  deleteHistoryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,77,77,0.4)',
    backgroundColor: 'rgba(255,77,77,0.08)',
  },
  deleteHistoryText: { color: colors.danger, fontSize: 14, fontWeight: '800' },

  // Status message (aligné sur Préférences / Véhicule)
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    marginTop: 18,
    borderWidth: 1,
  },
  statusError: { backgroundColor: 'rgba(255,77,77,0.08)', borderColor: 'rgba(255,77,77,0.25)' },
  statusSuccess: { backgroundColor: 'rgba(0,230,118,0.08)', borderColor: 'rgba(0,230,118,0.2)' },
  statusText: { fontSize: 13, fontWeight: '600', flex: 1 },

  // Save button (aligné sur Préférences / Véhicule)
  saveBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 17,
    borderRadius: 16,
    marginTop: 18,
    marginBottom: 20,
    gap: 10,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  saveBtnText: { color: colors.background, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

});

export default AccountInfoScreen;
