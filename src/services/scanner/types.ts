// Contrat partagé Android / iOS
// Chaque plateforme implémente ScannerService — le reste de l'app n'y touche pas

export type ScanPlatform = 'UBER' | 'BOLT' | 'HEETCH' | 'UNKNOWN';

export interface ScanResult {
  platform: ScanPlatform;
  fare: number;
  distanceKm: number;
  durationMin: number | null;
  /** Adresse de prise en charge extraite par l'OCR */
  pickupAddress?: string;
  /** Adresse de destination extraite par l'OCR */
  destinationAddress?: string;
}

/** Bloc texte brut retourné par ML Kit (Android) ou Vision (iOS) */
export interface TextBlock {
  text: string;
  width: number;   // largeur du bounding box en px
  height: number;  // hauteur — proxy de la taille de police
  x: number;       // position horizontale
  y: number;       // position verticale
}

export interface PermissionsStatus {
  overlay: boolean;
  accessibility: boolean;
  /** true sur Android < 11 (API 30) — nécessite un token MediaProjection */
  needsMediaProjection: boolean;
  /** true si le token MediaProjection a été accordé pour cette session */
  mediaProjectionGranted: boolean;
}

export interface ScannerService {
  /** Démarre le scanner (bulle Android / permission iOS) */
  start(): Promise<void>;
  /** Arrête le scanner */
  stop(): Promise<void>;
  /** Ouvre les paramètres système si une permission manque */
  openSettings(): void;
  /** true si le scanner est actif */
  isRunning(): Promise<boolean>;
  /** Envoie le verdict à la bulle / l'extension (0=rouge, 1=orange, 2=vert) */
  showVerdict(level: number): void;
  /** Met à jour la durée affichée dans la bulle avec la valeur TomTom */
  updateDuration(minutes: number): void;
  /** Initialise la clé API Gemini pour le fallback vision (dev uniquement) */
  setGeminiApiKey(key: string): void;
  /** Configure l'edge function Supabase comme proxy Gemini (prod) */
  setGeminiConfig(edgeUrl: string, supabaseAnonKey: string): void;
  /** Applique la remote config de parsing VTC depuis Supabase */
  setParserConfig(configJson: string): void;
  /** Vérifie l'état complet des permissions */
  checkPermissions(): Promise<PermissionsStatus>;
  /** Ouvre les paramètres overlay */
  openOverlayPermissionSettings(): void;
  /** Ouvre les paramètres d'accessibilité */
  openAccessibilitySettings(): void;
  /**
   * Lance le dialog système de capture d'écran (MediaProjection).
   * Nécessaire uniquement sur Android < 11.
   * Sur Android 11+ et iOS, résout immédiatement.
   */
  requestMediaProjectionPermission(): Promise<void>;
  /** Écoute les résultats de scan */
  onScanResult(cb: (result: ScanResult) => void): { remove: () => void } | undefined;
  /** Écoute les échecs */
  onScanFailed(cb: () => void): { remove: () => void } | undefined;
  /** Écoute le refus de permission */
  onPermissionDenied(cb: () => void): { remove: () => void } | undefined;
}
