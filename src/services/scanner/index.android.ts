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
  setTomTomApiKey: (key: string) => ScanBridge.setTomTomApiKey(key),
  clearGeocodeCache: () => ScanBridge.clearGeocodeCache?.(),
  setQuotaReached: (reached: boolean, isFree: boolean) => ScanBridge.setQuotaReached(reached, isFree),
  setScanQuota: (countToday: number, limit: number, resetHour: number) => ScanBridge.setScanQuota?.(countToday, limit, resetHour),
  // Android : la bulle est pilotée par start()/stop() (toggle iOS-only).
  setScannerEnabled: () => {},

  checkPermissions: () => ScanBridge.checkPermissions(),

  openOverlayPermissionSettings: () => ScanBridge.openOverlayPermissionSettings(),

  openAccessibilitySettings: () => ScanBridge.openAccessibilitySettings(),

  requestMediaProjectionPermission: () => ScanBridge.requestMediaProjectionPermission(),

  onScanResult: (cb: (result: ScanResult) => void) =>
    emitter.addListener('onScanResult', cb),

  onScanFailed: (cb: () => void) =>
    emitter.addListener('onScanFailed', cb),

  // Décisions Accepter/Refuser tapées sur la notification de résultat. On
  // s'abonne PUIS on draine le buffer natif (décisions prises pendant que le JS
  // n'écoutait pas / process mort) → elles atteignent le listener fraîchement posé.
  onRideDecision: (cb: (decision: { scanTs: number; status: 'ACCEPTED' | 'DECLINED' }) => void) => {
    const sub = emitter.addListener('onRideDecision', cb);
    ScanBridge.drainRideDecisions?.();
    return sub;
  },

  onPermissionDenied: (cb: () => void) =>
    emitter.addListener('onPermissionDenied', cb),
};
