import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  NativeModules,
  Platform,
  Pressable,
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

/**
 * Choix de la langue, en feuille montant du bas.
 *
 * Remplace la bascule directe au tap : avec deux langues elle suffisait, mais
 * elle ne disait pas ce qu'elle allait faire — on découvrait le résultat après
 * coup. Une feuille montre les options avant de choisir.
 *
 * « Langue de l'appareil » n'est pas une troisième langue : c'est l'effacement
 * du choix explicite, après quoi l'app suit de nouveau le réglage du téléphone.
 * C'est la valeur par défaut à l'installation, et rien ne permettait d'y revenir
 * une fois une langue choisie à la main.
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
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

  // Suivre l'appareil signifie « aucun choix stocké » : l'état ne se lit donc
  // pas dans i18n, qui affiche toujours une langue concrète.
  const [followsDevice, setFollowsDevice] = React.useState(false);

  useEffect(() => {
    if (!visible) return;
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

  const apply = async (lang: 'fr' | 'en' | null) => {
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
      const next = device === 'fr' ? 'fr' : 'en';
      await i18n.changeLanguage(next);
      await AsyncStorage.removeItem(STORE_LANGUAGE_KEY);
      pushToNative(next);
    } else if (lang !== i18n.language) {
      await i18n.changeLanguage(lang);
      pushToNative(lang);
    }
    onClose();
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

          <Text style={styles.title}>{t('preferences.language', 'Langue')}</Text>
          <Text style={styles.subtitle}>
            {t('preferences.languageSub', "Choisir la langue de l'app")}
          </Text>

          <View style={styles.options}>
            <Option
              label={t('preferences.languageDevice', "Langue de l'appareil")}
              selected={current === null}
              onPress={() => apply(null)}
            />
            <Option label="Français" selected={current === 'fr'} onPress={() => apply('fr')} />
            <Option label="English" selected={current === 'en'} onPress={() => apply('en')} />
            <Option label={t('common.cancel', 'Annuler')} muted onPress={onClose} />
          </View>
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
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  muted?: boolean;
}) => (
  <Pressable
    onPress={onPress}
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
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 18,
  },

  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  iconBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  title: { color: colors.textMain, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 6 },

  options: { marginTop: 22, gap: 10 },
  // 56 px : la feuille se manipule d'une main, souvent en marchant.
  option: {
    height: 56,
    borderRadius: 28,
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
