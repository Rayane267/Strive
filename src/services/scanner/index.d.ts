// Shim TS pour que `./services/scanner` résolve côté IDE.
// Metro choisit `index.android.ts` ou `index.ios.ts` à la compilation —
// ce .d.ts est ignoré par le bundler, il ne sert qu'au type-check.
import type { ScannerService } from './types';

export const scannerService: ScannerService;
export type { ScannerService, ScanResult, ScanPlatform, TextBlock, PermissionsStatus, RideDecision } from './types';
