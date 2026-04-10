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

  setGeminiApiKey: (key: string) => {
    ScanBridge?.setGeminiApiKey(key);
  },

  setGeminiConfig: (edgeUrl: string, supabaseAnonKey: string) => {
    ScanBridge?.setGeminiConfig(edgeUrl, supabaseAnonKey);
  },

  setParserConfig: (configJson: string) => {
    ScanBridge?.setParserConfig(configJson);
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

  onScanFailed: (cb: () => void) => {
    if (!emitter) return undefined;
    return emitter.addListener('onScanFailed', cb);
  },

  onPermissionDenied: (cb: () => void) => {
    if (!emitter) return undefined;
    return emitter.addListener('onPermissionDenied', cb);
  },
};
