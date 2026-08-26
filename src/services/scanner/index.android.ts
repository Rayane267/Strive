/**
 * Implémentation Android du scanner.
 *
 * Utilise le bridge Kotlin ScanBridgeModule :
 *   - FloatingBubbleService  → overlay sur les apps VTC
 *   - AccessibilityService   → screenshot (Android 11+)
 *   - MediaProjection        → screenshot (Android < 11)
 *   - ML Kit                 → OCR on-device
 */

import { NativeModules, NativeEventEmitter } from 'react-native';
import { ScannerService, ScanResult } from './types';

const { ScanBridge } = NativeModules;
const emitter = new NativeEventEmitter(ScanBridge);

export const scannerService: ScannerService = {
  start: () => ScanBridge.startScanner(),

  stop: () => ScanBridge.stopScanner(),

  openSettings: () => ScanBridge.openOverlaySettings(),

  isRunning: () => ScanBridge.isScannerRunning(),

  showVerdict: (level: number) => ScanBridge.showVerdict(level),

  updateDuration: (minutes: number) => ScanBridge.updateDuration(minutes),

  updateMetrics: (hourlyRate: number, kmRate: number, durationMin: number, distanceKm: number) =>
    ScanBridge.updateMetrics(hourlyRate, kmRate, durationMin, distanceKm),

  finalizeScan: (hourlyRate: number, kmRate: number, durationMin: number, distanceKm: number, verdictLevel: number) =>
    ScanBridge.finalizeScan(hourlyRate, kmRate, durationMin, distanceKm, verdictLevel),

  setGeminiConfig: (edgeUrl: string, supabaseAnonKey: string) =>
    ScanBridge.setGeminiConfig(edgeUrl, supabaseAnonKey),
  setSupabaseUserJwt: (jwt: string) => ScanBridge.setSupabaseUserJwt(jwt),
  setParserConfig: (configJson: string) => ScanBridge.setParserConfig(configJson),
  setPreferences: (includePickup: boolean) => ScanBridge.setPreferences(includePickup),
  setThresholds: (minHourlyRate: number, minKmRate: number) =>
    ScanBridge.setThresholds(minHourlyRate, minKmRate),
  setFuelDeduction: (enabled: boolean, fuelCostPerKm: number) =>
    ScanBridge.setFuelDeduction?.(enabled, fuelCostPerKm),
  setTomTomApiKey: (key: string) => ScanBridge.setTomTomApiKey(key),
  clearGeocodeCache: () => ScanBridge.clearGeocodeCache?.(),
  setQuotaReached: (reached: boolean, isFree: boolean) => ScanBridge.setQuotaReached(reached, isFree),
  setScanQuota: (countToday: number, limit: number, resetHour: number) => ScanBridge.setScanQuota?.(countToday, limit, resetHour),
  ackScan: (rideId: string) => ScanBridge.ackScan?.(rideId),

  getPendingRideDecisions: async () => {
    try {
      return (await ScanBridge.getPendingRideDecisions?.()) ?? [];
    } catch {
      return [];
    }
  },
  ackRideDecision: (rideId: string) => ScanBridge.ackRideDecision?.(rideId),
  queueRideDecision: (rideId: string, status: 'ACCEPTED' | 'DECLINED') =>
    ScanBridge.queueRideDecision?.(rideId, status === 'ACCEPTED'),
  // Retire la notification de résultat quand la décision a été prise dans
  // l'app : elle restait sinon affichée avec ses boutons, sur une course déjà
  // tranchée. Pendant de `clearLiveActivityResult` côté iOS.
  clearRideResult: (rideId: string) => ScanBridge.clearRideResult?.(rideId),
  // Android : la bulle est pilotée par start()/stop() (toggle iOS-only).
  setScannerEnabled: () => {},

  checkPermissions: () => ScanBridge.checkPermissions(),

  openOverlayPermissionSettings: () => ScanBridge.openOverlayPermissionSettings(),

  openAccessibilitySettings: () => ScanBridge.openAccessibilitySettings(),

  requestMediaProjectionPermission: () => ScanBridge.requestMediaProjectionPermission(),

  // On s'abonne PUIS on draine le buffer natif
  // (scans effectués par la bulle pendant que le process RN était mort) → ils
  // atteignent le listener fraîchement posé au lieu d'être perdus.
  onScanResult: (cb: (result: ScanResult) => void) => {
    const sub = emitter.addListener('onScanResult', cb);
    ScanBridge.drainPendingScans?.();
    return sub;
  },

  // On s'abonne PUIS on draine : les échecs survenus process RN mort sont
  // bufferisés côté natif et n'atteindraient sinon jamais la trace.
  onScanFailure: (cb: (f: any) => void) => {
    const sub = emitter.addListener('onScanFailure', cb);
    ScanBridge.drainScanFailures?.();
    return sub;
  },

  onScanFailed: (cb: () => void) =>
    emitter.addListener('onScanFailed', cb),

  // Décisions Accepter/Refuser tapées sur la notification de résultat. On
  // s'abonne PUIS on draine le buffer natif (décisions prises pendant que le JS
  // n'écoutait pas / process mort) → elles atteignent le listener fraîchement posé.

  onPermissionDenied: (cb: () => void) =>
    emitter.addListener('onPermissionDenied', cb),
};
