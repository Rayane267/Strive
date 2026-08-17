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
import * as Sentry from '@sentry/react-native';
import { supabase } from '../services/supabase';
import { updateProfile } from '../services/profileService';
import { useAuth } from '../context/AuthContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import PlanBadge from '../components/PlanBadge';
import { colors } from '../theme/colors';

import AvatarView from '../components/AvatarView';
import { Skeleton } from '../components/Skeleton';
import { hapticSuccess, hapticError } from '../utils/haptics';
import {
  dialForValue,
  expectedLengths,
  formatAsTyped,
  formatFullNumber,
  toCompactE164,
  validateFullNumberKey,
} from '../utils/phoneUtils';

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
          accessibilityLabel={label}
          accessibilityState={{ disabled: !editable }}
        />
      </View>
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
};

const AccountInfoScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  // `profile` n'est plus lu ici : PlanBadge le récupère lui-même.
  const { user, refreshProfile } = useAuth();
  const { isConnected } = useNetworkStatus();


  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingHistory, setDeletingHistory] = useState(false);
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
              Sentry.captureException(e, { tags: { flow: 'delete_history' } });
            } finally {
              setDeletingHistory(false);
            }
          },
        },
      ],
    );
  };

  // Le découpage suit l'indicatif détecté dans la saisie (ou celui de l'appareil).
  // L'ancien `replace(/(.{2})(?!$)/g)` coupait en paires de 2 sans rien savoir du
  // pays : un numéro stocké en E.164 s'affichait « +3 36 12 34 56 78 ».
  const formatPhoneNumber = (text: string) => formatFullNumber(text);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const filterName = (text: string) => text.replace(/[^a-zA-ZÀ-ÿ\s\-']/g, '').slice(0, 40);

  const filterPhone = (text: string) => text.replace(/[^0-9\s\+]/g, '').slice(0, 25);

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!formData.first_name.trim()) errs.first_name = t('profile.setup.errors.firstNameRequired', 'Prénom requis');
    if (!formData.last_name.trim()) errs.last_name = t('profile.setup.errors.lastNameRequired', 'Nom requis');
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errs.email = t('accountInfo.errors.emailInvalid', 'Email invalide');
    }
    // Longueur validée selon l'indicatif reconnu (9 chiffres pour +33, 10 pour
    // +1…), et non plus une fourchette 6–15 qui laissait passer n'importe quoi.
    const phoneKey = validateFullNumberKey(formData.phone);
    if (phoneKey) {
      const dial = dialForValue(formData.phone);
      errs.phone = t(phoneKey, { expected: expectedLengths(dial), code: dial.code });
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const buildBaseForm = useCallback(() => ({
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
  }), [user]);

  const [formData, setFormData] = useState(buildBaseForm);
  // Snapshot de référence pour le « dirty state » : le bouton Enregistrer ne
  // s'active que si formData diffère de ce qui a été chargé / dernier save.
  const [initialForm, setInitialForm] = useState(buildBaseForm);

  const isDirty =
    formData.first_name !== initialForm.first_name ||
    formData.last_name !== initialForm.last_name ||
    formData.phone !== initialForm.phone ||
    formData.avatar_url !== initialForm.avatar_url;

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

      const base = buildBaseForm();
      const merged = profileData
        ? {
            ...base,
            first_name: profileData.first_name || base.first_name,
            last_name: profileData.last_name || base.last_name,
            phone: profileData.phone ? formatPhoneNumber(profileData.phone) : base.phone,
            email: profileData.email || base.email,
            avatar_url: profileData.avatar_url || base.avatar_url,
          }
        : base;
      setFormData(merged);
      setInitialForm(merged);
    } catch (error) {
      __DEV__ && console.error('Erreur chargement profil:', error);
    } finally {
      setLoading(false);
    }
  }, [user, buildBaseForm]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Garde-fou : prévient avant de quitter l'écran avec des modifs non enregistrées.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty || saving) return;
      e.preventDefault();
      Alert.alert(
        t('common.unsavedTitle', 'Modifications non enregistrées'),
        t('common.unsavedMessage', 'Voulez-vous quitter sans enregistrer vos changements ?'),
        [
          { text: t('common.stay', 'Rester'), style: 'cancel' },
          { text: t('common.leave', 'Quitter'), style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ],
      );
    });
    return unsub;
  }, [navigation, isDirty, saving, t]);

  const handleSave = async () => {
    if (!user?.id) return;
    if (!validateForm()) return;
    // Hors-ligne : un update Supabase échouerait avec une erreur générique.
    // Message clair plutôt qu'un « Impossible d'enregistrer » trompeur.
    if (!isConnected) {
      hapticError();
      showToast({ type: 'warning', title: t('common.offlineTitle', 'Hors ligne'), message: t('common.offlineSave', 'Pas de connexion. Vos modifications seront à réenregistrer une fois en ligne.') });
      return;
    }
    setSaving(true);
    try {
      await updateProfile(user.id, {
        first_name: formData.first_name,
        last_name: formData.last_name,
        // Stocké en E.164 compact, comme à la création du profil — le champ
        // enregistrait jusqu'ici la chaîne d'affichage, espaces compris.
        phone: toCompactE164(formData.phone),
        avatar_url: formData.avatar_url,
      });
      if (refreshProfile) await refreshProfile();
      setInitialForm(formData); // le form devient « propre » → bouton re-grisé
      hapticSuccess();
      showToast({ type: 'success', title: t('common.success', 'Succès'), message: t('carSettings.success.saved', 'Enregistré avec succès.') });
    } catch (error: any) {
      hapticError();
      showToast({ type: 'error', title: t('common.error', 'Erreur'), message: t('accountInfo.errorSave', 'Impossible d\'enregistrer. Réessayez.') });
      __DEV__ && console.error('[ACCOUNT_SAVE] error:', error?.code, error?.message, error?.details, error?.hint);
      Sentry.captureException(error, { tags: { flow: 'profile_save' } });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header statique — seul le contenu chargé est en skeleton. */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.textMain} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{t('profile.account', 'Mon profil')}</Text>
            <Text style={styles.headerSub}>{t('accountInfo.subtitle', 'Informations personnelles')}</Text>
          </View>
          <View style={styles.planBadge}>
            <Skeleton width={40} height={12} radius={6} />
          </View>
        </View>

        <View style={styles.scroll}>
          <View style={styles.avatarSection}>
            <Skeleton width={100} height={100} radius={50} />
            <Skeleton width={160} height={22} radius={8} />
            <Skeleton width={120} height={14} radius={7} />
          </View>

          <View style={styles.formCard}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={styles.inputGroup}>
                <Skeleton width={90} height={11} radius={5} style={styles.skeletonLabel} />
                <Skeleton width="100%" height={52} radius={12} />
              </View>
            ))}
          </View>
        </View>
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
        <PlanBadge />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* ── AVATAR SECTION ── */}
          <View style={styles.avatarSection}>
            <AvatarView avatarId="generic" size={100} borderColor={colors.primary} />
            <Text style={styles.profileName}>{fullName}</Text>
            {user?.email ? <Text style={styles.profileEmail} numberOfLines={1}>{user.email}</Text> : null}
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
              onChangeText={text => { setFormData({ ...formData, phone: formatAsTyped(filterPhone(text)) }); setFieldErrors(e => ({ ...e, phone: '' })); }}
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

          {/* ── SAVE BUTTON ── */}
          <TouchableOpacity
            style={[styles.saveBtn, (saving || !isDirty) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving || !isDirty}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('preferences.save', 'Enregistrer')}
            accessibilityState={{ disabled: saving || !isDirty }}
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
  profileEmail: { color: colors.textDimmed, fontSize: 13, fontWeight: '500' },

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
  saveBtnDisabled: { opacity: 0.4, shadowOpacity: 0, elevation: 0 },
  skeletonLabel: { marginBottom: 7 },

});

export default AccountInfoScreen;
