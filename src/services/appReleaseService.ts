/**
 * « Mise à jour disponible » : la version installée face à la version publiée.
 *
 * La source est `app_release` (une ligne par plateforme, cf. migration
 * 20261015_app_release), tenue à la main après chaque publication. La mise à
 * jour est PROPOSÉE, jamais imposée : le chauffeur peut toujours l'ignorer.
 *
 * Une panne réseau ou une table vide ne gênent jamais l'ouverture : le doute
 * rend `none`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import { supabase } from './supabase';
import { APP_VERSION } from '../utils/appVersion';

export type ReleaseCheck =
  | { status: 'none' }
  | { status: 'available'; latest: string; notes: string[] };

/** « Plus tard » vaut pour cette version, une journée. */
const SNOOZE_KEY = '@strive_update_snooze';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

const STORE_URL = Platform.select({
  ios: 'itms-apps://apps.apple.com/app/id6772641578',
  android: 'market://details?id=com.striveapp.app',
}) ?? '';
const STORE_WEB_URL = Platform.select({
  ios: 'https://apps.apple.com/app/id6772641578',
  android: 'https://play.google.com/store/apps/details?id=com.striveapp.app',
}) ?? '';

/** Comparaison numérique segment par segment : « 1.0.10 » > « 1.0.9 ». */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function pickNotes(raw: unknown, language: string): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const byLang = raw as Record<string, unknown>;
  const lang = language.split('-')[0];
  const list = byLang[lang] ?? byLang.en ?? byLang.fr;
  return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : [];
}

export async function checkAppRelease(language: string): Promise<ReleaseCheck> {
  try {
    const { data, error } = await supabase
      .from('app_release')
      .select('latest_version, notes')
      .eq('platform', Platform.OS)
      .maybeSingle();
    if (error || !data?.latest_version) return { status: 'none' };

    if (compareVersions(APP_VERSION, data.latest_version) >= 0) return { status: 'none' };

    const raw = await AsyncStorage.getItem(SNOOZE_KEY);
    if (raw) {
      const snooze = JSON.parse(raw) as { version?: string; at?: number };
      if (snooze.version === data.latest_version && Date.now() - (snooze.at ?? 0) < SNOOZE_MS) {
        return { status: 'none' };
      }
    }
    return { status: 'available', latest: data.latest_version, notes: pickNotes(data.notes, language) };
  } catch {
    return { status: 'none' };
  }
}

export function snoozeRelease(version: string): void {
  AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify({ version, at: Date.now() })).catch(() => {});
}

/**
 * Plateforme et version installée, notées à chaque démarrage de session, que
 * le chauffeur ait accepté les push ou non. Sans ça, celui qui a refusé les
 * notifications reste invisible : ni son téléphone ni sa version ne sont
 * connus. `notify-release` s'en sert pour ne viser que les appareils en retard.
 *
 * Silencieux : un échec ne doit jamais gêner l'ouverture.
 */
export function reportAppVersion(userId: string): void {
  supabase
    .from('profiles')
    .update({ device_platform: Platform.OS, app_version: APP_VERSION })
    .eq('id', userId)
    .then(() => {}, () => {});
}

export function openStoreForUpdate(): void {
  Linking.openURL(STORE_URL).catch(() => Linking.openURL(STORE_WEB_URL).catch(() => {}));
}
