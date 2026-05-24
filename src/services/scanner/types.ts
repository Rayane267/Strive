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
  /** Temps d'approche (min) extrait par l'OCR — ligne "X min • X.X km" sous l'adresse de pickup */
  pickupDurationMin?: number;
  /** Distance d'approche (km) extraite par l'OCR */
  pickupDistanceKm?: number;
  /** Image JPEG compressée en base64 — servie par le natif pour alimenter le fallback LLM JS */
  imageBase64?: string;
  /** Dump JSON des blocs ML Kit/Vision pour diagnostic — populé en DEV uniquement côté natif */
  debugBlocks?: string;
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
  /** Met à jour toutes les métriques affichées dans la bulle (après calcul pickup + TomTom) */
  updateMetrics(hourlyRate: number, kmRate: number, durationMin: number, distanceKm: number): void;
  /** Transitionne la bulle de loading → résultat final avec valeurs TomTom + verdict. */
  finalizeScan(hourlyRate: number, kmRate: number, durationMin: number, distanceKm: number, verdictLevel: number): void;
  /** Configure l'edge function Supabase comme proxy Gemini (prod) */
  setGeminiConfig(edgeUrl: string, supabaseAnonKey: string): void;
  /** JWT user — requis par l'edge function durcie (rate-limit + audit par user_id) */
  setSupabaseUserJwt(jwt: string): void;
  /** Applique la remote config de parsing VTC depuis Supabase */
  setParserConfig(configJson: string): void;
  /** Transmet les préférences utilisateur à la bulle native (calcul initial avec/sans pickup) */
  setPreferences(includePickup: boolean): void;
  /** Seuils verdict (€/h et €/km) synchronisés au natif pour calcul TomTom en background */
  setThresholds(minHourlyRate: number, minKmRate: number): void;
  /** Clé TomTom — permet au service natif de géocoder sans JS actif */
  setTomTomApiKey(key: string): void;
  /** Quota journalier atteint — la bulle / Share Extension affiche "Quota atteint"
   *  et n'exécute ni OCR, ni TomTom, ni Gemini si true. */
  setQuotaReached(reached: boolean): void;
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
