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

/** Deux adresses partant du même endroit restent plausibles en dessous. */
const SAME_PLACE_MAX_KM = 2;

/**
 * Réduit une adresse à ce qui permet de la comparer à une autre.
 *
 * Casse, ponctuation, retours ligne et espaces multiples sautent : ce qui reste
 * est la suite des mots. Deux libellés que l'OCR a découpés différemment se
 * comparent alors sur leur contenu et non sur leur mise en forme.
 */
function comparable(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[\s\n]+/g, ' ')
    .replace(/[.,;:&'’-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Un résultat de scan dont les adresses sont PRÉSENTES mais manifestement fausses.
 *
 * Le filet diagnostique ne se déclenchait que sur une adresse ABSENTE, et c'est
 * un angle mort : un parser qui rate une adresse se signale, un parser qui en
 * invente une passe inaperçu. Or c'est le second cas qui est dangereux, parce
 * qu'il écrit une donnée fausse en base au lieu de laisser un trou.
 *
 * Deux signaux, tous deux constatés sur une vraie course de 44,40 km dont le
 * départ et l'arrivée étaient le même lieu :
 *
 *   1. **un retour ligne survit dans une adresse.** `mergeAddressContinuation`
 *      colle les lignes de continuation avec `\n` et documente lui-même qu'il
 *      faut le convertir en espace. Un `\n` qui arrive jusqu'ici signale donc
 *      soit une conversion oubliée, soit un collage de blocs qui n'allaient pas
 *      ensemble ;
 *   2. **le départ contient l'arrivée, ou l'inverse, sur une course longue.**
 *      Le test est l'inclusion et non l'égalité, parce que les deux champs
 *      n'avaient pas absorbé le même nombre de lignes de continuation : l'un
 *      était le préfixe de l'autre.
 *
 * Le seuil de distance existe parce qu'un aller-retour dans la même rue est
 * parfaitement possible sur quelques centaines de mètres.
 *
 * Une capture déclenchée par cette fonction se reconnaît dans `scan_debug` à ses
 * deux drapeaux `missing` à faux — la table n'a pas de colonne de motif, et
 * l'absence des deux motifs d'origine EST le motif.
 */
export function hasIncoherentAddresses(r: {
  pickupAddress?: string | null;
  destinationAddress?: string | null;
  distanceKm: number;
}): boolean {
  const pickup = r.pickupAddress ?? '';
  const dest = r.destinationAddress ?? '';
  if (!pickup || !dest) return false;

  if (pickup.includes('\n') || dest.includes('\n')) return true;

  if (r.distanceKm > SAME_PLACE_MAX_KM) {
    const a = comparable(pickup);
    const b = comparable(dest);
    if (a && b && (a.includes(b) || b.includes(a))) return true;
  }

  return false;
}
