import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@strive_rating_prompted';
const TRIGGER_COUNT = 5; // show after 5 accepted rides

// iOS : directement sur le formulaire d'avis de la fiche.
const STORE_URL = Platform.select({
  android: 'market://details?id=com.striveapp.app',
  ios: 'itms-apps://apps.apple.com/app/id6772641578?action=write-review',
}) ?? '';
// Repli quand aucune app de store n'ouvre le lien (Android sans Play Store).
const STORE_WEB_URL = Platform.select({
  android: 'https://play.google.com/store/apps/details?id=com.striveapp.app',
  ios: 'https://apps.apple.com/app/id6772641578?action=write-review',
}) ?? '';

export async function maybePromptRating(acceptedCount: number): Promise<boolean> {
  if (acceptedCount < TRIGGER_COUNT) return false;

  try {
    const already = await AsyncStorage.getItem(STORAGE_KEY);
    if (already) return false;
    return true;
  } catch {
    return false;
  }
}

export async function markRatingPrompted(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, '1');
  } catch {}
}

// Pas de `canOpenURL` devant l'ouverture : sans `LSApplicationQueriesSchemes`
// (iOS) ni `<queries>` (Android 11+), il répond « non » alors que l'ouverture
// marche — le bouton de la modale ne faisait rien, sur les deux plateformes.
export async function openStoreForRating(): Promise<void> {
  if (!STORE_URL) return;
  try {
    await Linking.openURL(STORE_URL);
  } catch {
    if (STORE_WEB_URL) await Linking.openURL(STORE_WEB_URL).catch(() => {});
  }
}
