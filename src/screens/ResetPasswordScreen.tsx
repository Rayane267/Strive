import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { Toast, useToast } from '../components/Toast';
import { colors } from '../theme/colors';
import BrandLoader from '../components/BrandLoader';

const ResetPasswordScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { toast, showToast, dismissToast } = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    // Supabase parse automatiquement le hash du deeplink (`#access_token=…`)
    // via getSessionFromUrl côté SDK. On vérifie qu'une session de recovery existe.
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });
  }, []);

  const handleSubmit = async () => {
    if (password.length < 8) {
      showToast({
        type: 'error',
        title: t('auth.errors.resetTitle', 'Réinitialisation'),
        message: t('auth.errors.weakPassword', 'Mot de passe trop faible (minimum 8 caractères)'),
      });
      return;
    }
    if (password !== confirm) {
      showToast({
        type: 'error',
        title: t('auth.errors.resetTitle', 'Réinitialisation'),
        message: t('auth.errors.passwordMismatch', 'Les mots de passe ne correspondent pas'),
      });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      showToast({
        type: 'success',
        title: t('auth.resetSuccessTitle', 'Mot de passe mis à jour'),
        message: t('auth.resetSuccess', 'Vous pouvez maintenant vous connecter avec votre nouveau mot de passe'),
      });
      setTimeout(() => navigation.navigate('Auth'), 1500);
    } catch (e: any) {
      showToast({
        type: 'error',
        title: t('auth.errors.resetTitle', 'Réinitialisation'),
        message: e?.message ?? '',
      });
    } finally {
      setLoading(false);
    }
  };

  if (hasSession === null) {
    return (
      <SafeAreaView style={styles.container}>
        <BrandLoader size={12} />
      </SafeAreaView>
    );
  }

  if (!hasSession) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>{t('auth.resetExpiredTitle', 'Lien expiré')}</Text>
        <Text style={styles.subtitle}>
          {t('auth.resetExpired', 'Le lien de réinitialisation est invalide ou a expiré. Demandez-en un nouveau.')}
        </Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={() => navigation.navigate('Auth')}>
          <Text style={styles.btnPrimaryText}>{t('auth.backToLogin', 'Retour à la connexion')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Toast data={toast} onDismiss={dismissToast} bottomOffset={40} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.form}>
        <Text style={styles.title}>{t('auth.resetTitle', 'Réinitialiser le mot de passe')}</Text>
        <Text style={styles.subtitle}>
          {t('auth.resetSubtitle', 'Choisissez un nouveau mot de passe (minimum 8 caractères).')}
        </Text>

        <TextInput
          style={styles.input}
          placeholder={t('auth.passwordPlaceholder', 'Mot de passe')}
          placeholderTextColor={colors.textDimmed}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password-new"
          textContentType="newPassword"
        />
        <TextInput
          style={styles.input}
          placeholder={t('auth.confirmPasswordPlaceholder', 'Confirmer le mot de passe')}
          placeholderTextColor={colors.textDimmed}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password-new"
          textContentType="newPassword"
        />

        <TouchableOpacity
          style={[styles.btnPrimary, loading && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={colors.background} />
            : <Text style={styles.btnPrimaryText}>{t('auth.resetCtaConfirm', 'Mettre à jour')}</Text>}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.background,
    paddingHorizontal: 24, justifyContent: 'center',
  },
  form: { gap: 14 },
  title: { color: colors.textMain, fontSize: 24, fontWeight: '900', marginBottom: 8 },
  subtitle: { color: colors.textMuted, fontSize: 14, marginBottom: 16, lineHeight: 20 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
    color: colors.textMain, fontSize: 15,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  btnPrimary: {
    paddingVertical: 14, borderRadius: 14,
    backgroundColor: colors.primary, alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnPrimaryText: { color: colors.background, fontSize: 15, fontWeight: '700' },
});

export default ResetPasswordScreen;
