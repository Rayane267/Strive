import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, NativeModules, Platform } from 'react-native';

import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import nl from './locales/nl.json';
import de from './locales/de.json';
import it from './locales/it.json';

// v2 : l'ancienne clé contenait aussi des langues auto-détectées, indiscernables d'un vrai choix.
export const STORE_LANGUAGE_KEY = 'user_language_v2';

/** Langue par défaut : celle de l'app quand le téléphone parle une langue non traduite. */
export const DEFAULT_LANGUAGE = 'fr';

function getDeviceLanguage(): string {
  try {
    // Hermes V1 (RN 0.84+) : Intl est le moyen le plus fiable (New Arch compatible)
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale) {
      const lang = intlLocale.toLowerCase().split(/[-_]/)[0];
      if (lang) return lang;
    }
    // Fallback legacy NativeModules
    const raw =
      Platform.OS === 'ios'
        ? NativeModules.SettingsManager?.settings?.AppleLocale ||
          NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        : NativeModules.I18nManager?.localeIdentifier;
    if (typeof raw !== 'string') return DEFAULT_LANGUAGE;
    const lang = raw.toLowerCase().split(/[-_]/)[0];
    return lang || DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Langues effectivement TRADUITES, et rien d'autre.
 *
 * Y déclarer un code sans son fichier ne donne pas une app dans cette langue :
 * i18next retombe clé par clé sur l'anglais, et le chauffeur obtient un écran
 * moitié-moitié — pire qu'une app franchement anglaise.
 *
 * À AJOUTER avec l'ouverture des marchés (`utils/market.ts` les annonce déjà
 * dans `market.locales`) : `es` (Espagne), `pt` (Portugal), `nl` (Belgique
 * néerlandophone), puis `de`/`it` pour la Suisse. Chaque ajout se fait en deux
 * lignes — l'import du JSON et une entrée dans `resources` — mais le JSON, lui,
 * c'est 1 138 chaînes à traduire.
 */
export const SUPPORTED = ['fr', 'en', 'es', 'pt', 'nl', 'de', 'it'] as const;

/** Langue du téléphone si elle est traduite, sinon le français. */
export function deviceLanguage(): string {
  const device = getDeviceLanguage();
  return (SUPPORTED as readonly string[]).includes(device) ? device : DEFAULT_LANGUAGE;
}

/**
 * Seul un choix explicite dans `LanguageSheet` écrit `STORE_LANGUAGE_KEY`.
 * Pas de `cacheUserLanguage` : i18next l'appelle aussi après la détection
 * initiale, ce qui figeait la langue du premier lancement comme un « choix ».
 */
const languageDetectorPlugin = {
  type: 'languageDetector' as const,
  async: true,
  init: () => {},
  detect: async function (callback: (lang: string) => void) {
    try {
      const stored = await AsyncStorage.getItem(STORE_LANGUAGE_KEY);
      if (stored && (SUPPORTED as readonly string[]).includes(stored)) {
        return callback(stored);
      }
      return callback(deviceLanguage());
    } catch {
      return callback(DEFAULT_LANGUAGE);
    }
  },
  cacheUserLanguage: () => {},
};

const resources = {
  en: { translation: en },
  fr: { translation: fr },
  es: { translation: es },
  pt: { translation: pt },
  nl: { translation: nl },
  de: { translation: de },
  it: { translation: it },
};

i18n
  .use(initReactI18next)
  .use(languageDetectorPlugin)
  .init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    compatibilityJSON: 'v4',
    interpolation: { escapeValue: false },
  });

// Le natif (Share Extension, bulle Android) suit chaque changement de langue.
i18n.on('languageChanged', lang => {
  NativeModules.ScanBridge?.setAppLanguage?.(lang);
});

// Changer la langue du téléphone s'applique au retour dans l'app, sans
// redémarrage — sauf si le chauffeur a choisi une langue lui-même.
AppState.addEventListener('change', async state => {
  if (state !== 'active') return;
  try {
    if (await AsyncStorage.getItem(STORE_LANGUAGE_KEY)) return;
  } catch {}
  const next = deviceLanguage();
  if (next !== i18n.language) i18n.changeLanguage(next);
});

export default i18n;
