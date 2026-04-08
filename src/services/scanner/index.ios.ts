/**
 * Implémentation iOS du scanner.
 *
 * Flow :
 *   1. Le chauffeur prend un screenshot natif (bouton power + volume)
 *   2. iOS affiche la Share Sheet
 *   3. Le chauffeur sélectionne "Strive"
 *   4. La Share Extension (Swift) extrait le texte via Vision framework
 *   5. Les blocs texte sont passés à ocrParser.ts (partagé avec Android)
 *   6. Le résultat est affiché dans l'extension et loggé dans Supabase
 *
 * TODO: brancher NativeModules.ShareExtensionBridge quand la Share Extension
 *       Swift sera créée. Les méthodes ci-dessous sont les stubs à implémenter.
 *
 * Note: MediaProjection et SYSTEM_ALERT_WINDOW n'existent pas sur iOS.
 * La bulle flottante est remplacée par le panneau Share Extension.
 */

import { ScannerService, ScanResult } from './types';

const ShareExtensionBridge = {
  isAvailable: () => Promise.resolve(false),
};

export const scannerService: ScannerService = {
  start: async () => {
    const available = await ShareExtensionBridge.isAvailable();
    if (!available) {
      throw { code: 'EXTENSION_NOT_AVAILABLE' };
    }
  },

  stop: async () => {},

  openSettings: () => {},

  isRunning: () => Promise.resolve(false),

  showVerdict: (_level: number) => {},

  updateDuration: (_minutes: number) => {},

  setGeminiApiKey: (_key: string) => {},
  setGeminiConfig: (_edgeUrl: string, _supabaseAnonKey: string) => {},
  setParserConfig: (_configJson: string) => {},

  checkPermissions: () => Promise.resolve({
    overlay: false,
    accessibility: false,
    needsMediaProjection: false,
    mediaProjectionGranted: false,
  }),

  openOverlayPermissionSettings: () => {},

  openAccessibilitySettings: () => {},

  // iOS n'a pas de MediaProjection — no-op
  requestMediaProjectionPermission: () => Promise.resolve(),

  onScanResult: (_cb: (result: ScanResult) => void) => undefined,
  onScanFailed: (_cb: () => void) => undefined,
  onPermissionDenied: (_cb: () => void) => undefined,
};
