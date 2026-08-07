/**
 * Trace des scans qui n'aboutissent PAS.
 *
 * `telemetryService` et `scanDebugService` ne s'écrivent que sur un scan qui
 * aboutit et remonte jusqu'au JS. Tout ce qui casse avant — raccourci iOS qui
 * meurt, Live Activity impossible à démarrer en arrière-plan, Gemini KO, quota,
 * verrou anti double-tap — ne laissait aucune trace : un bug pouvait toucher
 * tout le parc sans qu'aucune donnée ne le montre.
 *
 * Même régime que scan_debug (RLS owner-only, RPC security-definer, 30 j) —
 * voir migration 20260806_scan_failures.sql.
 *
 * Fire-and-forget : une erreur de traçage ne doit JAMAIS impacter le scan.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

/** Vocabulaire fermé, aligné sur le CHECK du RPC. */
export type ScanFailureReason =
  | 'scanner_off'
  | 'session_off'
  | 'quota_reached'
  | 'invalid_image'
  | 'throttled'
  | 'ocr_empty'
  | 'not_a_ride'
  | 'gemini_ko'
  | 'no_addresses'
  | 'la_start_failed'
  | 'expired'
  | 'timeout';

/** Où le scan a été déclenché. */
export type ScanSurface = 'shortcut' | 'share_ext' | 'bubble';

/**
 * Code affiché à l'utilisateur quand un scan échoue, pour qu'il puisse le citer
 * en support. Miroir EXACT de `ScanErrorCode` (ios/Strive/Scanner/ScanModels.swift) —
 * toute modification doit être répercutée des deux côtés.
 *
 * Codes OPAQUES au format hexadécimal `0xC0FEnnnn` : le message affiché explique
 * le problème en clair, le code ne sert que de référence support et ne révèle
 * rien de l'interne. Le préfixe de « facility » fixe identifie un code Strive au
 * premier coup d'œil dans un ticket ; l'hexadécimal (0-9, A-F) écarte toute
 * confusion O/0 ou I/L/1 à la recopie.
 *
 * ⚠️ Contrat public : ces valeurs vivent dans l'historique de support.
 * Ne jamais réaffecter un code à un autre motif.
 *
 * Sert à décoder un code rapporté par un chauffeur — notamment depuis la Share
 * Extension, qui affiche des erreurs mais n'écrit rien dans `scan_failures` :
 * le code est alors le seul canal de remontée.
 */
export const SCAN_ERROR_CODES: Record<ScanFailureReason, string> = {
  scanner_off:     '0xC0FE0113',
  session_off:     '0xC0FE0207',
  quota_reached:   '0xC0FE0342',
  invalid_image:   '0xC0FE0418',
  throttled:       '0xC0FE0526',
  ocr_empty:       '0xC0FE0631',
  no_addresses:    '0xC0FE074B',
  not_a_ride:      '0xC0FE0859',
  gemini_ko:       '0xC0FE0962',
  la_start_failed: '0xC0FE0A7D',
  expired:         '0xC0FE0B34',
  timeout:         '0xC0FE0C55',
};

/**
 * Motif correspondant à un code rapporté par un utilisateur, ou null.
 * Tolérant à la casse et au préfixe manquant — un chauffeur recopie rarement
 * « 0xC0FE074B » à l'identique (souvent « c0fe074b » ou « 0XC0FE074B »).
 */
export function reasonFromCode(code: string): ScanFailureReason | null {
  const normalize = (s: string) => s.trim().toUpperCase().replace(/^0X/, '');
  const wanted = normalize(code);
  if (!wanted) return null;
  const hit = (Object.keys(SCAN_ERROR_CODES) as ScanFailureReason[])
    .find(r => normalize(SCAN_ERROR_CODES[r]) === wanted);
  return hit ?? null;
}

export type ScanFailure = {
  reason: ScanFailureReason | string;
  surface: ScanSurface | string;
  /** Plateforme VTC si lue avant l'échec (souvent inconnue). */
  platform?: string | null;
  /** Complément court : code d'erreur ActivityKit, motif brut… */
  detail?: string | null;
  appVersion: string;
  /**
   * Horodatage réel de l'échec, en secondes epoch. Indispensable : côté iOS
   * l'AppIntent tourne dans un autre process et empile ses échecs dans l'App
   * Group — ils ne remontent qu'au prochain passage au premier plan, parfois
   * bien plus tard. Sans ça l'analyse temporelle est fausse.
   */
  occurredAt?: number | null;
};

export function logScanFailure(f: ScanFailure): void {
  try {
    supabase
      .rpc('log_scan_failure', {
        p_reason: f.reason,
        p_os: Platform.OS,
        p_surface: f.surface,
        p_platform: f.platform ?? null,
        p_detail: f.detail ?? null,
        p_app_version: f.appVersion,
        p_occurred_at: f.occurredAt
          ? new Date(f.occurredAt * 1000).toISOString()
          : null,
      })
      .then(undefined, () => {});
  } catch {
    // jamais bloquant
  }
}

/** Vidange d'un lot remonté par le natif (file App Group / SharedPreferences). */
export function logScanFailures(list: ScanFailure[]): void {
  for (const f of list) logScanFailure(f);
}

// ─── Mémoire locale du dernier échec (contexte des tickets de support) ────────
//
// Le chauffeur qui ouvre un ticket vient presque toujours de vivre un échec.
// On garde le dernier localement pour le joindre au message : sans ça, un
// « le scan marche pas » arrive sans version, sans surface et sans motif, et
// il faut trois allers-retours pour savoir de quoi on parle.
//
// Local uniquement (AsyncStorage), jamais synchronisé : `scan_failures` reste
// la source de vérité côté serveur. Un seul enregistrement, écrasé à chaque fois.

const RECENT_FAILURES_KEY = '@strive/recentScanFailures';

/**
 * Trois, pas un : au moment d'ouvrir un ticket, le chauffeur DÉSIGNE l'erreur
 * qui motive sa demande. Un seul échec mémorisé forçait à deviner que le dernier
 * était le bon — or il ouvre souvent son ticket bien après l'incident, et parfois
 * pour autre chose. Trois couvrent une session sans noyer le choix.
 */
const MAX_RECENT = 3;

export type LastFailure = {
  reason: ScanFailureReason | string;
  surface: ScanSurface | string;
  /** Epoch ms — quand l'échec a eu lieu, pas quand il a été relevé. */
  at: number;
};

const isValid = (f: any): f is LastFailure =>
  f && typeof f.reason === 'string' && typeof f.at === 'number';

/** Mémorise un échec, plus récent d'abord. Fire-and-forget : ne bloque jamais un scan. */
export function rememberLastFailure(f: ScanFailure): void {
  const entry: LastFailure = {
    reason: f.reason,
    surface: f.surface,
    at: f.occurredAt ? f.occurredAt * 1000 : Date.now(),
  };
  (async () => {
    try {
      const list = await getRecentFailures();
      // Dédoublonnage : trois fois « adresses illisibles » d'affilée n'offrent
      // qu'un seul choix utile et évinceraient les deux autres motifs.
      const deduped = list.filter(x => x.reason !== entry.reason);
      const next = [entry, ...deduped].slice(0, MAX_RECENT);
      await AsyncStorage.setItem(RECENT_FAILURES_KEY, JSON.stringify(next));
    } catch {
      /* jamais bloquant */
    }
  })();
}

/** Les échecs récents, plus récent d'abord. Tableau vide si rien. Ne throw jamais. */
export async function getRecentFailures(): Promise<LastFailure[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_FAILURES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValid).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Dernier échec connu, ou null. */
export async function getLastFailure(): Promise<LastFailure | null> {
  return (await getRecentFailures())[0] ?? null;
}
