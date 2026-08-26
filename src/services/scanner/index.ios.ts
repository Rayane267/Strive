/**
 * Implémentation iOS du scanner.
 *
 * Flow :
 *   1. Le chauffeur prend un screenshot natif (bouton power + volume)
 *   2. iOS affiche la Share Sheet
 *   3. Le chauffeur sélectionne "Analyser avec Strive"
 *   4. La Share Extension (Swift) extrait le texte via Vision framework
 *   5. Le résultat est parsé localement dans l'extension
 *   6. Les données sont passées à l'app principale via App Group + Darwin notification
 *   7. Le ScanBridgeModule émet onScanResult vers JavaScript
 *
 * Note: MediaProjection et SYSTEM_ALERT_WINDOW n'existent pas sur iOS.
 * La bulle flottante Android est remplacée par le panneau Share Extension.
 */

import { NativeModules, NativeEventEmitter } from 'react-native';
import { ScannerService, ScanResult } from './types';

const { ScanBridge } = NativeModules;
const emitter = ScanBridge ? new NativeEventEmitter(ScanBridge) : null;

// Le bridge natif n'expose qu'une seule méthode pour les préférences scanner
// (alignement avec App Group). On garde le dernier état JS pour pouvoir merger
// les setters granulaires (setThresholds / setPreferences).
let lastMinHourly: number | null = null;
let lastMinKm: number | null = null;
let lastIncludePickup: boolean | null = null;

export const scannerService: ScannerService = {
  start: async () => {
    if (!ScanBridge) throw { code: 'MODULE_NOT_AVAILABLE' };
    return ScanBridge.startScanner();
  },

  stop: async () => {
    if (!ScanBridge) return;
    return ScanBridge.stopScanner();
  },

  openSettings: () => {
    // Sur iOS, pas de paramètres spéciaux à ouvrir
  },

  isRunning: () => {
    if (!ScanBridge) return Promise.resolve(false);
    return ScanBridge.isScannerRunning();
  },

  showVerdict: (level: number) => {
    ScanBridge?.showVerdict(level);
  },

  updateDuration: (minutes: number) => {
    ScanBridge?.updateDuration(minutes);
  },

  updateMetrics: (hourlyRate: number, kmRate: number, durationMin: number, distanceKm: number) => {
    // Pousse la mise à jour vers la Live Activity (Dynamic Island).
    // Pas de "platform" / "fare" disponible ici — l'activité a déjà ces valeurs
    // depuis le start. Update partiel via les champs qui changent (TomTom).
    ScanBridge?.updateLiveActivity({
      hourlyRate, kmRate, durationMin, distanceKm,
      // Réutilise les derniers reçus côté natif via App Group si dispo.
      platform: 'UNKNOWN', fare: 0, verdictLevel: 0,
    });
  },

  finalizeScan: (hourlyRate: number, kmRate: number, durationMin: number, distanceKm: number, verdictLevel: number) => {
    ScanBridge?.updateLiveActivity({
      platform: 'UNKNOWN', fare: 0,
      hourlyRate, kmRate, durationMin, distanceKm, verdictLevel,
    });
  },

  setGeminiConfig: (edgeUrl: string, supabaseAnonKey: string) => {
    ScanBridge?.setGeminiConfig(edgeUrl, supabaseAnonKey);
  },

  setSupabaseUserJwt: (jwt: string) => {
    ScanBridge?.setSupabaseUserJwt(jwt);
  },

  setParserConfig: (configJson: string) => {
    ScanBridge?.setParserConfig(configJson);
  },

  setPreferences: (includePickup: boolean) => {
    // Les valeurs sont mergées en App Group avec les seuils par setScannerPreferences.
    // Si les seuils n'ont pas encore été poussés, on utilise des fallbacks par défaut.
    const minHr = lastMinHourly ?? 25.0;
    const minKm = lastMinKm ?? 1.2;
    lastIncludePickup = includePickup;
    ScanBridge?.setScannerPreferences(minHr, minKm, includePickup);
  },

  setFuelDeduction: (enabled: boolean, fuelCostPerKm: number) => {
    ScanBridge?.setFuelDeduction?.(enabled, fuelCostPerKm);
  },

  setThresholds: (minHourlyRate: number, minKmRate: number) => {
    lastMinHourly = minHourlyRate;
    lastMinKm = minKmRate;
    ScanBridge?.setScannerPreferences(
      minHourlyRate,
      minKmRate,
      lastIncludePickup ?? false,
    );
  },

  setTomTomApiKey: (key: string) => {
    ScanBridge?.setTomTomApiKey(key);
  },

  clearGeocodeCache: () => {
    ScanBridge?.clearGeocodeCache();
  },

  setQuotaReached: (reached: boolean, isFree: boolean) => {
    ScanBridge?.setQuotaReached(reached, isFree);
  },

  getPendingRideDecisions: async () => {
    try {
      return (await ScanBridge?.getPendingRideDecisions?.()) ?? [];
    } catch {
      return [];
    }
  },

  ackRideDecision: (rideId: string) => {
    ScanBridge?.ackRideDecision?.(rideId);
  },

  queueRideDecision: (rideId: string, status: 'ACCEPTED' | 'DECLINED') => {
    ScanBridge?.queueRideDecision?.(rideId, status === 'ACCEPTED');
  },

  ackScan: (rideId: string) => {
    ScanBridge?.ackScan?.(rideId);
  },

  clearRideResult: (rideId: string) => {
    ScanBridge?.clearLiveActivityResult?.(rideId);
  },

  setScanQuota: (countToday: number, limit: number, resetHour: number) => {
    ScanBridge?.setScanQuota?.(countToday, limit, resetHour);
  },

  setScannerEnabled: (enabled: boolean) => {
    // `?.` : un bundle JS peut tourner sur un binaire natif antérieur à l'export
    // de cette méthode (canaux EAS) — sans ça l'appel jetterait un TypeError.
    ScanBridge?.setScannerEnabled?.(enabled);
  },

checkPermissions: async () => {
    if (!ScanBridge) {
      return {
        overlay: true,
        accessibility: true,
        needsMediaProjection: false,
        mediaProjectionGranted: true,
      };
    }
    return ScanBridge.checkPermissions();
  },

  openOverlayPermissionSettings: () => {
    // No-op — iOS n'a pas de permission overlay
  },

  openAccessibilitySettings: () => {
    // No-op — iOS n'a pas de permission accessibility
  },

  requestMediaProjectionPermission: async () => {
    // No-op — iOS n'a pas de MediaProjection
  },

  onScanResult: (cb: (result: ScanResult) => void) => {
    if (!emitter) return undefined;
    return emitter.addListener('onScanResult', cb);
  },

  // La vidange est faite côté natif à `startObserving` et à chaque retour au
  // premier plan (l'AppIntent tourne dans un autre process et empile ses échecs
  // dans l'App Group) — il suffit donc de s'abonner.
  onScanFailure: (cb: (f: any) => void) => {
    if (!emitter) return undefined;
    return emitter.addListener('onScanFailure', cb);
  },

  onScanFailed: (cb: () => void) => {
    if (!emitter) return undefined;
    return emitter.addListener('onScanFailed', cb);
  },

  onPermissionDenied: (cb: () => void) => {
    if (!emitter) return undefined;
    return emitter.addListener('onPermissionDenied', cb);
  },
};
