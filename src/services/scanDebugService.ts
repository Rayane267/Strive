/**
 * Capture diagnostique des scans qui RATENT une adresse (pickup/destination).
 *
 * ⚠️ Contrairement à telemetryService (non nominatif), ceci stocke des DONNÉES
 * PERSONNELLES (adresses dans les blocs OCR) → table scan_debug, RLS owner-only,
 * écriture via RPC security-definer, rétention 30 j.
 * Voir migration 20260613_scan_debug.sql.
 *
 * BASE LÉGALE : intérêt légitime (RGPD art. 6.1.f), déclaré dans
 * `PRIVACY_POLICY.md` §2.6 — et non un consentement, contrairement à ce que
 * disait cet en-tête. L'opposition prévue par l'art. 21 est portée par
 * `preferences.scan_debug_opt_out` : la RPC sort sans rien écrire quand le
 * drapeau est levé (migration 20260826). Le Dashboard le teste aussi avant
 * d'appeler, pour ne pas envoyer des adresses qui seront refusées.
 *
 * But : reproduire les cas en fixture pour corriger le parser, et amorcer un
 * dataset labellisé (native vs gemini vs, plus tard, correction utilisateur).
 * Fire-and-forget : une erreur ne doit JAMAIS impacter le scan.
 */

import { supabase } from './supabase';

export type ScanDebugCapture = {
  platform: string;
  /** Hauteur image OCR (px) si connue (null si le natif ne la fournit pas). */
  screenHeight: number | null;
  /** Dump JSON des blocs natifs ([{text,x,y,w,h}]) — string brute. */
  blocksJson?: string;
  nativePickup: string | null;
  nativeDestination: string | null;
  nativeFare: number;
  nativeDistanceKm: number;
  nativeDurationMin: number | null;
  pickupMissing: boolean;
  destMissing: boolean;
  geminiUsed: boolean;
  geminiPickup: string | null;
  geminiDestination: string | null;
  appVersion: string;
};

export function logScanDebug(c: ScanDebugCapture): void {
  try {
    // Les blocs arrivent en string JSON depuis le natif → on parse pour envoyer
    // un vrai tableau jsonb (et on avale un JSON corrompu sans bloquer).
    let blocks: unknown = null;
    if (c.blocksJson) {
      try { blocks = JSON.parse(c.blocksJson); } catch { blocks = null; }
    }

    supabase
      .rpc('log_scan_debug', {
        p_platform: c.platform,
        p_screen_height: c.screenHeight,
        p_blocks: blocks,
        p_native_pickup: c.nativePickup,
        p_native_destination: c.nativeDestination,
        p_native_fare: c.nativeFare,
        p_native_distance_km: c.nativeDistanceKm,
        p_native_duration_min: c.nativeDurationMin,
        p_pickup_missing: c.pickupMissing,
        p_dest_missing: c.destMissing,
        p_gemini_used: c.geminiUsed,
        p_gemini_pickup: c.geminiPickup,
        p_gemini_destination: c.geminiDestination,
        p_app_version: c.appVersion,
      })
      .then(undefined, () => {});
  } catch {
    // jamais bloquant
  }
}
