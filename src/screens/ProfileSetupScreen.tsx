import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Image,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { Toast, useToast } from '../components/Toast';
import { supabase } from '../services/supabase';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';

// ─── Indicatifs pays ──────────────────────────────────────────────────────────

const DIAL_CODES = [
  { code: '+33',  flag: '🇫🇷', nameKey: 'countries.fr',  digits: [9] },
  { code: '+32',  flag: '🇧🇪', nameKey: 'countries.be',  digits: [8, 9] },
  { code: '+41',  flag: '🇨🇭', nameKey: 'countries.ch',  digits: [9] },
  { code: '+352', flag: '🇱🇺', nameKey: 'countries.lu',  digits: [6, 7, 8, 9] },
  { code: '+213', flag: '🇩🇿', nameKey: 'countries.dz',  digits: [9] },
  { code: '+212', flag: '🇲🇦', nameKey: 'countries.ma',  digits: [9] },
  { code: '+216', flag: '🇹🇳', nameKey: 'countries.tn',  digits: [8] },
  { code: '+221', flag: '🇸🇳', nameKey: 'countries.sn',  digits: [9] },
  { code: '+225', flag: '🇨🇮', nameKey: 'countries.ci',  digits: [10] },
  { code: '+237', flag: '🇨🇲', nameKey: 'countries.cm',  digits: [9] },
  { code: '+223', flag: '🇲🇱', nameKey: 'countries.ml',  digits: [8] },
  { code: '+224', flag: '🇬🇳', nameKey: 'countries.gn',  digits: [9] },
  { code: '+351', flag: '🇵🇹', nameKey: 'countries.pt',  digits: [9] },
  { code: '+34',  flag: '🇪🇸', nameKey: 'countries.es',  digits: [9] },
  { code: '+39',  flag: '🇮🇹', nameKey: 'countries.it',  digits: [9, 10] },
  { code: '+44',  flag: '🇬🇧', nameKey: 'countries.gb',  digits: [10] },
  { code: '+49',  flag: '🇩🇪', nameKey: 'countries.de',  digits: [10, 11] },
  { code: '+40',  flag: '🇷🇴', nameKey: 'countries.ro',  digits: [9] },
  { code: '+48',  flag: '🇵🇱', nameKey: 'countries.pl',  digits: [9] },
  { code: '+1',   flag: '🇺🇸', nameKey: 'countries.us',  digits: [10] },
];

// ─── Validation — retourne des clés i18n ─────────────────────────────────────

function validatePhoneKey(number: string, dial: typeof DIAL_CODES[number]): string | null {
  const cleaned = number.replace(/[\s\-\.\(\)]/g, '').replace(/^0+/, '');
  if (!cleaned) return 'profile.setup.errors.phoneRequired';
  if (!/^\d+$/.test(cleaned)) return 'profile.setup.errors.phoneInvalid';
  if (!dial.digits.includes(cleaned.length)) return 'profile.setup.errors.phoneLength';
  return null;
}

function validateDobKey(day: string, month: string, year: string): string | null {
  if (!day || !month || !year) return 'profile.setup.errors.dobRequired';
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return 'profile.setup.errors.dobInvalid';
  if (m < 1 || m > 12)  return 'profile.setup.errors.dobMonthInvalid';
  if (d < 1 || d > 31)  return 'profile.setup.errors.dobDayInvalid';
  if (y < 1920 || y > new Date().getFullYear()) return 'profile.setup.errors.dobYearInvalid';
  const date = new Date(y, m - 1, d);
  if (date.getDate() !== d || date.getMonth() !== m - 1 || date.getFullYear() !== y) {
    return 'profile.setup.errors.dobNotExist';
  }
  const today = new Date();
  const age = today.getFullYear() - y
    - (today.getMonth() < m - 1 || (today.getMonth() === m - 1 && today.getDate() < d) ? 1 : 0);
  if (age < 18) return 'profile.setup.errors.dobMinAge';
  return null;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export default function ProfileSetupScreen() {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { toast, showToast, dismissToast } = useToast();

  const [firstName, setFirstName]     = useState('');
  const [lastName, setLastName]       = useState('');
  const [dialCode, setDialCode]       = useState(DIAL_CODES[0]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dobDay, setDobDay]           = useState('');
  const [dobMonth, setDobMonth]       = useState('');
  const [dobYear, setDobYear]         = useState('');
  const [avatarUrl, setAvatarUrl]     = useState('');
  const [loading, setLoading]         = useState(false);
  const [dialPickerOpen, setDialPickerOpen] = useState(false);

  const [errors, setErrors] = useState({
    firstName: '', lastName: '', phone: '', dob: '',
  });

  const monthRef = useRef<TextInput>(null);
  const yearRef  = useRef<TextInput>(null);

  // Pré-remplir depuis les métadonnées Google / Apple
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const meta = user.user_metadata ?? {};
      const given  = meta.given_name  || meta.full_name?.givenName
        || (meta.name ?? meta.full_name ?? '').split(' ')[0] || '';
      const family = meta.family_name || meta.full_name?.familyName
        || (meta.name ?? meta.full_name ?? '').split(' ').slice(1).join(' ') || '';
      if (given)  setFirstName(given);
      if (family) setLastName(family);
      if (meta.avatar_url || meta.picture) setAvatarUrl(meta.avatar_url || meta.picture);
    });
  }, []);

  const clearError = (field: keyof typeof errors) =>
    setErrors(prev => ({ ...prev, [field]: '' }));

  const validate = (): boolean => {
    const phoneKey = validatePhoneKey(phoneNumber, dialCode);
    const dobKey   = validateDobKey(dobDay, dobMonth, dobYear);
    const next = {
      firstName: firstName.trim() ? '' : t('profile.setup.errors.firstNameRequired'),
      lastName:  lastName.trim()  ? '' : t('profile.setup.errors.lastNameRequired'),
      phone:     phoneKey ? t(phoneKey) : '',
      dob:       dobKey   ? t(dobKey)   : '',
    };
    setErrors(next);
    return Object.values(next).every(e => e === '');
  };

  const saveProfile = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t('errors.profileLoadFailed'));

      const fullPhone = `${dialCode.code}${phoneNumber.replace(/[\s\-\.\(\)]/g, '')}`;
      const birthDate = `${dobYear}-${dobMonth.padStart(2, '0')}-${dobDay.padStart(2, '0')}`;

      const { error } = await supabase.from('profiles').upsert({
        id:         user.id,
        email:      user.email,
        first_name: firstName.trim(),
        last_name:  lastName.trim(),
        phone:      fullPhone,
        birth_date: birthDate,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      });

      if (error) throw error;
      await refreshProfile();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: t('profile.setup.errors.saveFailed'),
        message: err.message ?? t('errors.saveFailed'),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Toast data={toast} onDismiss={dismissToast} bottomOffset={40} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Avatar ── */}
          <View style={styles.avatarWrap}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <MaterialCommunityIcons name="account" size={42} color={colors.textDimmed} />
              </View>
            )}
          </View>

          <Text style={styles.title}>{t('profile.setup.title')}</Text>
          <Text style={styles.subtitle}>{t('profile.setup.subtitle')}</Text>

          {/* ── Prénom ── */}
          <FieldLabel text={t('profile.setup.firstName')} />
          <View style={[styles.inputWrap, !!errors.firstName && styles.inputWrapError]}>
            <Feather name="user" size={16} color={errors.firstName ? colors.danger : colors.textDimmed} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('profile.setup.placeholderFirstName')}
              placeholderTextColor={colors.textDimmed}
              value={firstName}
              onChangeText={v => { setFirstName(v.replace(/[^a-zA-ZÀ-ÿ\s\-']/g, '').slice(0, 40)); clearError('firstName'); }}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>
          <FieldError msg={errors.firstName} />

          {/* ── Nom ── */}
          <FieldLabel text={t('profile.setup.lastName')} />
          <View style={[styles.inputWrap, !!errors.lastName && styles.inputWrapError]}>
            <Feather name="user" size={16} color={errors.lastName ? colors.danger : colors.textDimmed} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('profile.setup.placeholderLastName')}
              placeholderTextColor={colors.textDimmed}
              value={lastName}
              onChangeText={v => { setLastName(v.replace(/[^a-zA-ZÀ-ÿ\s\-']/g, '').slice(0, 40)); clearError('lastName'); }}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>
          <FieldError msg={errors.lastName} />

          {/* ── Téléphone ── */}
          <FieldLabel text={t('profile.setup.phone')} />
          <View style={[styles.phoneRow, !!errors.phone && styles.inputWrapError]}>
            <TouchableOpacity
              style={styles.dialBtn}
              onPress={() => setDialPickerOpen(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.dialFlag}>{dialCode.flag}</Text>
              <Text style={styles.dialCode}>{dialCode.code}</Text>
              <Feather name="chevron-down" size={12} color={colors.textDimmed} />
            </TouchableOpacity>
            <View style={styles.dialDivider} />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder={t('profile.setup.placeholderPhone')}
              placeholderTextColor={colors.textDimmed}
              value={phoneNumber}
              onChangeText={v => { setPhoneNumber(v.replace(/[^0-9\s\-\.]/g, '').slice(0, 15)); clearError('phone'); }}
              keyboardType="phone-pad"
              returnKeyType="next"
            />
          </View>
          <FieldError msg={errors.phone} />

          {/* ── Date de naissance ── */}
          <FieldLabel text={t('profile.setup.dob')} />
          <View style={[styles.dobRow, !!errors.dob && styles.inputWrapError]}>
            <TextInput
              style={styles.dobInput}
              placeholder={t('profile.setup.placeholderDay')}
              placeholderTextColor={colors.textDimmed}
              value={dobDay}
              onChangeText={v => {
                const n = v.replace(/\D/g, '').slice(0, 2);
                setDobDay(n); clearError('dob');
                if (n.length === 2) monthRef.current?.focus();
              }}
              keyboardType="numeric"
              maxLength={2}
              returnKeyType="next"
            />
            <Text style={styles.dobSep}>/</Text>
            <TextInput
              ref={monthRef}
              style={styles.dobInput}
              placeholder={t('profile.setup.placeholderMonth')}
              placeholderTextColor={colors.textDimmed}
              value={dobMonth}
              onChangeText={v => {
                const n = v.replace(/\D/g, '').slice(0, 2);
                setDobMonth(n); clearError('dob');
                if (n.length === 2) yearRef.current?.focus();
              }}
              keyboardType="numeric"
              maxLength={2}
              returnKeyType="next"
            />
            <Text style={styles.dobSep}>/</Text>
            <TextInput
              ref={yearRef}
              style={[styles.dobInput, styles.dobInputYear]}
              placeholder={t('profile.setup.placeholderYear')}
              placeholderTextColor={colors.textDimmed}
              value={dobYear}
              onChangeText={v => {
                const n = v.replace(/\D/g, '').slice(0, 4);
                setDobYear(n); clearError('dob');
              }}
              keyboardType="numeric"
              maxLength={4}
              returnKeyType="done"
            />
          </View>
          <FieldError msg={errors.dob} />

          {/* ── CTA ── */}
          <TouchableOpacity
            style={[styles.button, loading && { opacity: 0.7 }]}
            onPress={saveProfile}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <>
                <Feather name="arrow-right" size={18} color={colors.background} />
                <Text style={styles.buttonText}>{t('profile.setup.submit')}</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Modal indicatif ── */}
      <Modal
        visible={dialPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setDialPickerOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalSheet} edges={['bottom']}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('profile.setup.dialPickerTitle')}</Text>
              <TouchableOpacity onPress={() => setDialPickerOpen(false)}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={DIAL_CODES}
              keyExtractor={item => item.code + item.nameKey}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.dialItem, item.code === dialCode.code && styles.dialItemActive]}
                  onPress={() => { setDialCode(item); setDialPickerOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dialItemFlag}>{item.flag}</Text>
                  <Text style={styles.dialItemName}>{t(item.nameKey)}</Text>
                  <Text style={styles.dialItemCode}>{item.code}</Text>
                  {item.code === dialCode.code && (
                    <Feather name="check" size={16} color={colors.primary} />
                  )}
                </TouchableOpacity>
              )}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

const FieldLabel = ({ text }: { text: string }) => (
  <Text style={styles.label}>{text}</Text>
);

const FieldError = ({ msg }: { msg: string }) => {
  if (!msg) return null;
  return (
    <View style={styles.errorRow}>
      <Feather name="alert-circle" size={13} color={colors.danger} />
      <Text style={styles.errorText}>{msg}</Text>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },

  avatarWrap: { alignSelf: 'center', marginBottom: 24 },
  avatar: { width: 84, height: 84, borderRadius: 42, borderWidth: 2, borderColor: colors.primary },
  avatarPlaceholder: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },

  title: { fontSize: 26, fontWeight: '900', color: colors.textMain, marginBottom: 8, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.textMuted, lineHeight: 21, marginBottom: 28 },

  label: {
    fontSize: 11, fontWeight: '700', color: colors.primary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 14, marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  inputWrapError: { borderColor: colors.danger },
  inputIcon: { marginLeft: 14, marginRight: 2 },
  input: { paddingVertical: 15, paddingHorizontal: 10, fontSize: 16, color: colors.textMain },

  phoneRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 14, marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden',
  },
  dialBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 15 },
  dialFlag: { fontSize: 20 },
  dialCode: { fontSize: 14, color: colors.textMain, fontWeight: '600' },
  dialDivider: { width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.1)', marginRight: 4 },

  dobRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 14, marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 14,
  },
  dobInput: { paddingVertical: 15, fontSize: 16, color: colors.textMain, textAlign: 'center', width: 44 },
  dobInputYear: { width: 64 },
  dobSep: { color: colors.textDimmed, fontSize: 18, fontWeight: '300', marginHorizontal: 2 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 14, marginTop: 2 },
  errorText: { color: colors.danger, fontSize: 12, flex: 1 },

  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, paddingVertical: 17, borderRadius: 14, marginTop: 16,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '800' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%', paddingHorizontal: 20 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', marginBottom: 8,
  },
  modalTitle: { color: colors.textMain, fontSize: 17, fontWeight: '700' },
  dialItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  dialItemActive: { backgroundColor: 'rgba(0,230,118,0.05)' },
  dialItemFlag: { fontSize: 22 },
  dialItemName: { flex: 1, color: colors.textMain, fontSize: 15 },
  dialItemCode: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
