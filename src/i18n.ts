import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

import en from './locales/en.json';
import fr from './locales/fr.json';

const STORE_LANGUAGE_KEY = 'user_language';

/**
 * Récupère la langue du système (sans dépendance externe).
 * - iOS : NativeModules.SettingsManager.settings.AppleLocale ou AppleLanguages[0]
 * - Android : NativeModules.I18nManager.localeIdentifier
 * Renvoie un code ISO 2 lettres ('fr', 'en', etc.) ou 'en' par défaut.
 */
function getDeviceLanguage(): string {
  try {
    const raw =
      Platform.OS === 'ios'
        ? NativeModules.SettingsManager?.settings?.AppleLocale ||
          NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        : NativeModules.I18nManager?.localeIdentifier;
    if (typeof raw !== 'string') return 'en';
    const lang = raw.toLowerCase().split(/[-_]/)[0];
    return lang || 'en';
  } catch {
    return 'en';
  }
}

const SUPPORTED = ['fr', 'en'] as const;

const languageDetectorPlugin = {
  type: 'languageDetector' as const,
  async: true,
  init: () => {},
  detect: async function (callback: (lang: string) => void) {
    try {
      // 1. Toujours prioriser la langue du téléphone
      const device = getDeviceLanguage();
      const detected = (SUPPORTED as readonly string[]).includes(device) ? device : 'en';

      // 2. Choix utilisateur explicite uniquement s'il diffère de la langue device
      const stored = await AsyncStorage.getItem(STORE_LANGUAGE_KEY);
      if (stored && (SUPPORTED as readonly string[]).includes(stored)) {
        return callback(stored);
      }
      return callback(detected);
    } catch {
      return callback('en');
    }
  },
  cacheUserLanguage: async function (language: string) {
    try {
      await AsyncStorage.setItem(STORE_LANGUAGE_KEY, language);
    } catch {}
  },
};

const resources = {
  en: { translation: en },
  fr: { translation: fr },
};

i18n
  .use(initReactI18next)
  .use(languageDetectorPlugin)
  .init({
    resources,
    fallbackLng: 'en',
    compatibilityJSON: 'v4',
    interpolation: { escapeValue: false },
  });

export default i18n;
