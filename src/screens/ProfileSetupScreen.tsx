import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
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
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { useAuth } from '../context/AuthContext';
import { FIELD_TOP } from '../theme/field';
import ScreenField from '../components/ScreenField';
import {
  DIAL_CODES,
  DEFAULT_DIAL,
  expectedLengths,
  formatNational,
  toE164,
  validateNationalKey,
} from '../utils/phoneUtils';

// Normalise pour la recherche : minuscules + suppression des accents.
const normalizeSearch = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ─── Validation — retourne des clés i18n ─────────────────────────────────────

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
  const [dialCode, setDialCode]       = useState(DEFAULT_DIAL);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dobDay, setDobDay]           = useState('');
  const [dobMonth, setDobMonth]       = useState('');
  const [dobYear, setDobYear]         = useState('');
  const [avatarUrl, setAvatarUrl]     = useState('');
  const [loading, setLoading]         = useState(false);
  const [dialPickerOpen, setDialPickerOpen] = useState(false);
  const [dialQuery, setDialQuery] = useState('');

  const filteredDialCodes = useMemo(() => {
    const q = normalizeSearch(dialQuery.trim());
    if (!q) return DIAL_CODES;
    return DIAL_CODES.filter(item =>
      normalizeSearch(t(item.nameKey)).includes(q) ||
      item.code.replace('+', '').includes(q.replace('+', '')),
    );
  }, [dialQuery, t]);

  const [errors, setErrors] = useState({
    firstName: '', lastName: '', phone: '', dob: '',
  });

  // Chaînage du clavier. `returnKeyType="next"` DESSINE la touche mais ne fait
  // rien tout seul : sans `onSubmitEditing`, le chauffeur appuyait sur « Suivant »
  // et le clavier se contentait de se fermer.
  const lastNameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
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
    const phoneKey = validateNationalKey(phoneNumber, dialCode);
    const dobKey   = validateDobKey(dobDay, dobMonth, dobYear);
    const next = {
      firstName: firstName.trim() ? '' : t('profile.setup.errors.firstNameRequired'),
      lastName:  lastName.trim()  ? '' : t('profile.setup.errors.lastNameRequired'),
      // Le message de longueur annonce le nombre de chiffres attendu pour
      // l'indicatif choisi — « invalide » seul ne dit pas quoi corriger.
      phone:     phoneKey
        ? t(phoneKey, { count: dialCode.digits[0], expected: expectedLengths(dialCode), code: dialCode.code })
        : '',
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

      // `toE164` retire le préfixe national : la concaténation brute stockait
      // « +330612345678 » (0 en trop) alors que la validation, elle, l'enlevait.
      const fullPhone = toE164(phoneNumber, dialCode);
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
      {/* Pose en premier, donc derriere tout le reste. Il remplit la zone SOUS
          l'encoche, et `container` porte la meme couleur que son sommet : la
          bande de statut se confond avec lui au lieu de faire un bandeau. */}
      <ScreenField />
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
              onSubmitEditing={() => lastNameRef.current?.focus()}
              submitBehavior="submit"
            />
          </View>
          <FieldError msg={errors.firstName} />

          {/* ── Nom ── */}
          <FieldLabel text={t('profile.setup.lastName')} />
          <View style={[styles.inputWrap, !!errors.lastName && styles.inputWrapError]}>
            <Feather name="user" size={16} color={errors.lastName ? colors.danger : colors.textDimmed} style={styles.inputIcon} />
            <TextInput
              ref={lastNameRef}
              style={styles.input}
              placeholder={t('profile.setup.placeholderLastName')}
              placeholderTextColor={colors.textDimmed}
              value={lastName}
              onChangeText={v => { setLastName(v.replace(/[^a-zA-ZÀ-ÿ\s\-']/g, '').slice(0, 40)); clearError('lastName'); }}
              autoCapitalize="words"
              returnKeyType="next"
              onSubmitEditing={() => phoneRef.current?.focus()}
              submitBehavior="submit"
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
              ref={phoneRef}
              style={[styles.input, { flex: 1 }]}
              placeholder={t('profile.setup.placeholderPhone')}
              placeholderTextColor={colors.textDimmed}
              value={phoneNumber}
              onChangeText={v => { setPhoneNumber(formatNational(v, dialCode)); clearError('phone'); }}
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
                // Dernier champ de la saisie, et le pavé numérique iOS n'a pas
                // de touche Retour : sans ça le clavier restait ouvert sur le
                // bouton de validation, qu'il fallait deviner derrière.
                if (n.length === 4) Keyboard.dismiss();
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
        onRequestClose={() => { setDialPickerOpen(false); setDialQuery(''); }}
      >
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalSheet} edges={['bottom']}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('profile.setup.dialPickerTitle')}</Text>
              <TouchableOpacity onPress={() => { setDialPickerOpen(false); setDialQuery(''); }}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.dialSearchWrap}>
              <Feather name="search" size={16} color={colors.textDimmed} style={styles.dialSearchIcon} />
              <TextInput
                style={styles.dialSearchInput}
                placeholder={t('profile.setup.dialSearchPlaceholder', 'Rechercher un pays ou un indicatif')}
                placeholderTextColor={colors.textDimmed}
                value={dialQuery}
                onChangeText={setDialQuery}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {dialQuery.length > 0 && (
                <TouchableOpacity onPress={() => setDialQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Feather name="x-circle" size={16} color={colors.textDimmed} />
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              data={filteredDialCodes}
              keyExtractor={item => item.code + item.nameKey}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.dialEmpty}>{t('profile.setup.dialNoResult', 'Aucun pays trouvé')}</Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.dialItem, item.code === dialCode.code && styles.dialItemActive]}
                  // Le découpage dépend du pays : on re-formate le numéro déjà
                  // saisi, sinon il garde les espaces de l'indicatif précédent.
                  onPress={() => {
                    setDialCode(item);
                    setPhoneNumber(prev => formatNational(prev, item));
                    setDialPickerOpen(false);
                    setDialQuery('');
                  }}
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
  container: { flex: 1, backgroundColor: FIELD_TOP },
  scroll: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.xxl },

  avatarWrap: { alignSelf: 'center', marginBottom: space.xl },
  avatar: { width: 84, height: 84, borderRadius: radius.full, borderWidth: strokeWidth.control, borderColor: colors.primary },
  avatarPlaceholder: {
    width: 84, height: 84, borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
    justifyContent: 'center', alignItems: 'center',
  },

  title: { fontSize: 26, fontWeight: '900', color: colors.textMain, marginBottom: space.sm, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.textMuted, lineHeight: 21, marginBottom: space.xl },

  label: {
    fontSize: 11, fontWeight: '700', color: colors.primary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: space.sm,
  },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: space.sm,
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
  },
  inputWrapError: { borderColor: colors.danger },
  inputIcon: { marginLeft: space.md, marginRight: space.tight },
  input: { paddingVertical: space.lg, paddingHorizontal: space.sm, fontSize: 16, color: colors.textMain },

  phoneRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: space.sm,
    borderWidth: strokeWidth.control, borderColor: stroke.edge, overflow: 'hidden',
  },
  dialBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.lg },
  dialFlag: { fontSize: 20 },
  dialCode: { fontSize: 14, color: colors.textMain, fontWeight: '600' },
  dialDivider: { width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.1)', marginRight: space.xs },

  dobRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: space.sm,
    borderWidth: strokeWidth.control, borderColor: stroke.edge, paddingHorizontal: space.md,
  },
  dobInput: { paddingVertical: space.lg, fontSize: 16, color: colors.textMain, textAlign: 'center', width: 44 },
  dobInputYear: { width: 64 },
  dobSep: { color: colors.textDimmed, fontSize: 18, fontWeight: '300', marginHorizontal: space.tight },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.md, marginTop: space.tight },
  errorText: { color: colors.danger, fontSize: 12, flex: 1 },

  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    backgroundColor: colors.primary, paddingVertical: space.lg, borderRadius: radius.md, marginTop: space.lg,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  buttonText: { color: colors.background, fontSize: 16, fontWeight: '800' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%', paddingHorizontal: space.xl },
  modalHandle: { width: 36, height: 4, borderRadius: radius.xs, backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'center', marginTop: space.md, marginBottom: space.xs },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: space.lg, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', marginBottom: space.sm,
  },
  modalTitle: { color: colors.textMain, fontSize: 17, fontWeight: '700' },
  dialSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.background, borderRadius: radius.sm,
    paddingHorizontal: space.md, marginBottom: space.sm,
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
  },
  dialSearchIcon: { marginRight: space.tight },
  dialSearchInput: { flex: 1, paddingVertical: space.md, fontSize: 15, color: colors.textMain },
  dialEmpty: { color: colors.textDimmed, fontSize: 14, textAlign: 'center', paddingVertical: space.xl },
  dialItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, gap: space.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  dialItemActive: { backgroundColor: 'rgba(0,230,118,0.05)' },
  dialItemFlag: { fontSize: 22 },
  dialItemName: { flex: 1, color: colors.textMain, fontSize: 15 },
  dialItemCode: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
