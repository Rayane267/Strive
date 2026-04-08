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

  setGeminiApiKey: (key: string) => ScanBridge.setGeminiApiKey(key),
  setGeminiConfig: (edgeUrl: string, supabaseAnonKey: string) =>
    ScanBridge.setGeminiConfig(edgeUrl, supabaseAnonKey),
  setParserConfig: (configJson: string) => ScanBridge.setParserConfig(configJson),

  checkPermissions: () => ScanBridge.checkPermissions(),

  openOverlayPermissionSettings: () => ScanBridge.openOverlayPermissionSettings(),

  openAccessibilitySettings: () => ScanBridge.openAccessibilitySettings(),

  requestMediaProjectionPermission: () => ScanBridge.requestMediaProjectionPermission(),

  onScanResult: (cb: (result: ScanResult) => void) =>
    emitter.addListener('onScanResult', cb),

  onScanFailed: (cb: () => void) =>
    emitter.addListener('onScanFailed', cb),

  onPermissionDenied: (cb: () => void) =>
    emitter.addListener('onPermissionDenied', cb),
};
