import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { hapticLight } from '../utils/haptics';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { useAuth } from '../context/AuthContext';
import { updateProfile } from '../services/profileService';
import { scannerService } from '../services/scanner';
import { MARKETS, LANGUAGE_NAMES, CURRENCY_CODE, type CountryCode } from '../utils/market';
import { SUPPORTED } from '../i18n';

/**
 * Choix de la langue, en feuille montant du bas.
 *
 * Remplace la bascule directe au tap : avec deux langues elle suffisait, mais
 * elle ne disait pas ce qu'elle allait faire — on découvrait le résultat après
 * coup. Une feuille montre les options avant de choisir.
 *
 * « Langue de l'appareil » n'est pas une langue de plus : c'est l'effacement
 * du choix explicite, après quoi l'app suit de nouveau le réglage du téléphone.
 * C'est la valeur par défaut à l'installation, et rien ne permettait d'y revenir
 * une fois une langue choisie à la main.
 *
 * ── DEUX TEMPS : LA LANGUE, PUIS LE PAYS ───────────────────────────────────
 * La langue ne dit pas le pays, et c'est le pays qui porte la devise, l'unité de
 * distance et le régime de cotisations. `fr` ne sépare pas la France de la
 * Belgique ni de la Suisse ; `nl` ne sépare pas les Pays-Bas de la Belgique ;
 * `pt` et `es` débordent largement l'Europe. Deviner l'un depuis l'autre,
 * c'était calculer le seuil de rentabilité d'un chauffeur bruxellois avec les
 * cotisations françaises.
 *
 * La seconde étape ne se saute donc pas après un changement de langue : c'est
 * le seul moment où le chauffeur a une raison de se poser la question, et il
 * voit la devise qu'il va lire partout ensuite.
 */

const STORE_LANGUAGE_KEY = 'user_language';
const DURATION = 260;

const LanguageSheet = ({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

  // Suivre l'appareil signifie « aucun choix stocké » : l'état ne se lit donc
  // pas dans i18n, qui affiche toujours une langue concrète.
  const [followsDevice, setFollowsDevice] = React.useState(false);
  /** `lang` puis `market` : on ne demande le pays qu'une fois la langue choisie. */
  const [step, setStep] = React.useState<'lang' | 'market'>('lang');
  const [savingCountry, setSavingCountry] = React.useState(false);

  useEffect(() => {
    if (!visible) return;
    // Rouvrir la feuille repart de la langue : c'est ce que le chauffeur vient
    // chercher, et l'étape pays n'a de sens qu'à la suite d'un choix.
    setStep('lang');
    AsyncStorage.getItem(STORE_LANGUAGE_KEY).then(v => setFollowsDevice(!v));
  }, [visible]);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : DURATION,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [visible, anim, reduceMotion]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [520, 0] });

  const apply = async (lang: string | null) => {
    hapticLight();
    if (lang === null) {
      // Effacer la clé AVANT de changer de langue : `cacheUserLanguage` la
      // réécrirait aussitôt, et le choix « suivre l'appareil » ne survivrait pas
      // au prochain démarrage.
      await AsyncStorage.removeItem(STORE_LANGUAGE_KEY);
      const device = (NativeModules.SettingsManager?.settings?.AppleLocale
        || NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        || NativeModules.I18nManager?.localeIdentifier
        || 'en').slice(0, 2);
      const next = (SUPPORTED as readonly string[]).includes(device) ? device : 'en';
      await i18n.changeLanguage(next);
      await AsyncStorage.removeItem(STORE_LANGUAGE_KEY);
      pushToNative(next);
    } else if (lang !== i18n.language) {
      await i18n.changeLanguage(lang);
      pushToNative(lang);
    }
    setStep('market');
  };

  /**
   * Le pays fixe la devise, l'unité de distance, le régime de cotisations et le
   * plancher de rentabilité. Écrit sur le profil : il PRIME sur la région de
   * l'appareil, qui n'était qu'une valeur par défaut.
   */
  const applyCountry = async (country: CountryCode) => {
    hapticLight();
    if (!user?.id || country === profile?.country) {
      onClose();
      return;
    }
    setSavingCountry(true);
    try {
      await updateProfile(user.id, { country });
      await refreshProfile?.();
      // Le natif géocode avec ce pays : sans ce rappel, le prochain scan
      // chercherait encore l'adresse dans l'ancien.
      scannerService.setMarketCountry?.(country);
    } catch {
      // On ferme quand même : réessayer est un geste, pas une impasse.
    } finally {
      setSavingCountry(false);
      onClose();
    }
  };

  // Le natif doit suivre : sans ça, les libellés de la Share Extension et de la
  // bulle Android restent dans l'ancienne langue.
  const pushToNative = (lang: string) => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      NativeModules.ScanBridge?.setAppLanguage?.(lang);
    }
  };

  const current = followsDevice ? null : i18n.language;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Le fond est tapable pour fermer, et reste sous la feuille : un
            Pressable enveloppant capterait aussi les taps sur les options. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[styles.sheet, { paddingBottom: insets.bottom + 20, transform: [{ translateY }] }]}
        >
          <View style={styles.handle} />

          <View style={styles.headRow}>
            <View style={styles.iconBadge}>
              <Feather name="globe" size={20} color={colors.primary} />
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close', 'Fermer')}
            >
              <Feather name="x" size={24} color={colors.textMain} />
            </Pressable>
          </View>

          {step === 'lang' ? (
            <>
              <Text style={styles.title}>{t('preferences.language', 'Langue')}</Text>
              <Text style={styles.subtitle}>
                {t('preferences.languageSub', "Choisir la langue de l'app")}
              </Text>

              {/* Défilable depuis qu'il y a sept langues : à quatre lignes tout
                  tenait, à neuf la dernière sortait de l'écran sur un petit
                  téléphone — et une option qu'on ne voit pas n'existe pas. */}
              <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={styles.options}
                showsVerticalScrollIndicator={false}
              >
                <Option
                  label={t('preferences.languageDevice', "Langue de l'appareil")}
                  selected={current === null}
                  onPress={() => apply(null)}
                />
                {/* Chaque langue porte son propre nom : on ne cherche pas
                    « Néerlandais » quand on cherche « Nederlands ». */}
                {SUPPORTED.map(code => (
                  <Option
                    key={code}
                    label={LANGUAGE_NAMES[code] ?? code}
                    selected={current === code}
                    onPress={() => apply(code)}
                  />
                ))}
                <Option label={t('common.cancel', 'Annuler')} muted onPress={onClose} />
              </ScrollView>
            </>
          ) : (
            <>
              <Text style={styles.title}>{t('preferences.country', 'Pays et devise')}</Text>
              <Text style={styles.subtitle}>
                {t(
                  'preferences.countrySub',
                  'Il fixe votre devise, vos cotisations et votre seuil de rentabilité.',
                )}
              </Text>

              <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={styles.options}
                showsVerticalScrollIndicator={false}
              >
                {(Object.keys(MARKETS) as CountryCode[]).map(code => {
                  const m = MARKETS[code];
                  return (
                    <Option
                      key={code}
                      label={`${t(`countries.${code.toLowerCase()}`)}  ·  ${m.symbol} ${CURRENCY_CODE[m.currency]}`}
                      selected={profile?.country === code}
                      disabled={savingCountry}
                      onPress={() => applyCountry(code)}
                    />
                  );
                })}
                <Option label={t('common.cancel', 'Annuler')} muted onPress={onClose} />
              </ScrollView>
            </>
          )}

        </Animated.View>
      </View>
    </Modal>
  );
};

const Option = ({
  label,
  onPress,
  selected,
  muted,
  disabled,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  muted?: boolean;
  disabled?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      styles.option,
      selected && styles.optionSelected,
      pressed && styles.optionPressed,
    ]}
    accessibilityRole="button"
    accessibilityState={{ selected: !!selected }}
    accessibilityLabel={label}
  >
    <Text
      style={[
        styles.optionText,
        selected && styles.optionTextSelected,
        muted && styles.optionTextMuted,
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },

  sheet: {
    backgroundColor: colors.surfaceLight,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.xs,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: space.lg,
  },

  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  iconBadge: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  title: { color: colors.textMain, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: space.sm },

  // Plafonné à 60 % de la hauteur : au-delà, la feuille mangerait tout l'écran
  // et on ne verrait plus ce qu'elle recouvre.
  optionsScroll: { maxHeight: Dimensions.get('window').height * 0.6 },
  options: { marginTop: space.xl, gap: space.sm, paddingBottom: space.xs },
  // 56 px : la feuille se manipule d'une main, souvent en marchant.
  option: {
    height: 56,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  optionSelected: { backgroundColor: colors.primary + '26' },
  // Enfoncement plutôt que changement de couleur : teinter au doigt brouillerait
  // l'état sélectionné, qui utilise déjà la teinte verte.
  optionPressed: { opacity: 0.7 },

  optionText: { color: colors.textMain, fontSize: 17, fontWeight: '600' },
  optionTextSelected: { color: colors.primary, fontWeight: '800' },
  optionTextMuted: { color: colors.textMuted },
});

export default LanguageSheet;
