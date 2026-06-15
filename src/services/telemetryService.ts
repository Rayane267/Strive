/**
 * Télémétrie produit NON NOMINATIVE pour mesurer la qualité réelle de l'OCR
 * sur le parc (taux de détection d'adresse, coût Gemini, verdicts). Aucune
 * donnée perso n'est envoyée : ni adresse, ni montant exact, ni coordonnées.
 *
 * Écriture via le RPC `log_scan_event` (security definer) — voir migration
 * 20260607_scan_events.sql. Fire-and-forget : une erreur télémétrie ne doit
 * JAMAIS impacter le scan ou l'enregistrement de la course.
 */

import { supabase } from './supabase';

export type ScanTelemetry = {
  platform: string;
  /** 0, 1 ou 2 adresses extraites (métrique cœur). */
  addressesFound: number;
  /** true si le fallback Gemini (JS) a été utilisé. */
  geminiFallback: boolean;
  /** 'reported' = durée lue (OCR/TomTom) ; 'estimated' = estimée via distance. */
  durationSource: 'reported' | 'estimated';
  /** 0 = rouge, 1 = orange, 2 = vert. */
  verdict: number;
  fareBucket: string;
};

/** Tranche de prix (jamais le montant exact, pour rester non nominatif). */
export function fareBucket(fare: number): string {
  if (!Number.isFinite(fare) || fare <= 0) return 'unknown';
  if (fare < 10) return '5-10';
  if (fare < 20) return '10-20';
  if (fare < 30) return '20-30';
  if (fare < 50) return '30-50';
  return '50+';
}

/** Log d'un scan. Fire-and-forget : toute erreur est avalée. */
export function logScanEvent(t: ScanTelemetry): void {
  try {
    supabase
      .rpc('log_scan_event', {
        p_platform: t.platform,
        p_addresses_found: t.addressesFound,
        p_gemini_fallback: t.geminiFallback,
        p_duration_source: t.durationSource,
        p_verdict: t.verdict,
        p_fare_bucket: t.fareBucket,
      })
      .then(undefined, () => {});
  } catch {
    // jamais bloquant
  }
}
