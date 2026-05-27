import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@strive_rating_prompted';
const TRIGGER_COUNT = 5; // show after 5 accepted rides

const STORE_URL = Platform.select({
  android: 'market://details?id=com.strive',
  ios: 'itms-apps://itunes.apple.com/app/id6772641578',
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

export async function openStoreForRating(): Promise<void> {
  if (!STORE_URL) return;
  const canOpen = await Linking.canOpenURL(STORE_URL);
  if (canOpen) Linking.openURL(STORE_URL);
}
