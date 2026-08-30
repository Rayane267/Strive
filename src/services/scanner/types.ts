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
  /** Dump JSON des blocs ML Kit/Vision pour diagnostic — émis en release pour
   *  alimenter scan_debug quand une adresse manque. Format : [{text,x,y,w,h}]. */
  debugBlocks?: string;
  /** Hauteur de l'image OCR (px) — nécessaire pour rejouer un cas en fixture. */
  screenHeight?: number;
  /** Horodatage du scan (epoch s). Donnée, plus clé : il date la course (jour
   *  d'affectation, registre de quota) mais n'identifie plus rien. */
  scanTs?: number;
  /**
   * Identité de la course, frappée par le natif AU MOMENT DU SCAN. C'est la clé
   * primaire en base (`rides.id`), l'entrée du journal natif, et ce que
   * renvoient les boutons Prise/Refusée.
   *
   * Une seule valeur pour les trois, et connue avant l'insertion : c'est ce qui
   * rend l'écriture idempotente (`on conflict (id) do nothing`) et permet
   * d'appliquer une décision par simple `update … where id = rideId`, sans
   * jamais avoir à retrouver la course.
   *
   * Optionnel pour une raison de transition : un bundle JS récent peut tourner
   * sur un binaire natif antérieur, ou trouver dans le journal des entrées
   * écrites avant la mise à jour. Absent → l'id est laissé au serveur, comme
   * avant (`ridesService.createRide`).
   */
  rideId?: string;
}

/** Décision Prise/Refusée tapée hors de l'app : bouton de la Live Activity,
 *  action de notification, commande vocale. */
export interface RideDecision {
  rideId: string;
  status: 'ACCEPTED' | 'DECLINED';
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
  /** Affichage du prix net de carburant dans la Live Activity. `fuelCostPerKm`
   *  est pré-calculé côté JS (conso × prix du jour) : le natif n'a ni le type de
   *  carburant ni le tarif à la pompe. Affichage seul — le verdict, les €/h,
   *  les €/km et le tarif enregistré restent bruts. */
  setFuelDeduction(enabled: boolean, fuelCostPerKm: number): void;
  /** Clé TomTom — permet au service natif de géocoder sans JS actif */
  setTomTomApiKey(key: string): void;
  /** Purge le cache de géocodage local (adresses = PII). À appeler au logout et
   *  après suppression de compte — RGPD : le cache vit sur l'appareil, hors de
   *  portée de la RPC serveur delete_account. */
  clearGeocodeCache(): void;
  /** Quota journalier atteint — la bulle / Share Extension affiche "Quota atteint"
   *  et n'exécute ni OCR, ni TomTom, ni Gemini si true. `isFree` permet de
   *  réserver le teaser verrouillé (vendre Plus) aux seuls comptes free. */
  setQuotaReached(reached: boolean, isFree: boolean): void;
  /** Pousse le compteur de scans du jour (autoritatif) + la limite + l'heure de
   *  reset du quota (0 ou 4h) au natif, pour qu'il applique le quota lui-même
   *  (scan via extension/bulle = JS suspendu) en situant correctement la
   *  frontière de journée. `limit <= 0` = illimité. */
  setScanQuota(countToday: number, limit: number, resetHour: number): void;

  /** Acquitte un scan du journal natif : la course est en base. Tant qu'un scan
   *  n'est pas acquitté il est ré-émis à chaque relève — c'est ce qui garantit
   *  qu'aucune course ne se perd. */
  ackScan(rideId: string): void;
  /** Les décisions Prise/Refusée en attente (boutons Live Activity, actions de
   *  notification, commandes vocales). Lecture seule : rien n'est retiré ici.
   *  Le Dashboard les demande quand il peut les écrire en base. */
  getPendingRideDecisions(): Promise<RideDecision[]>;
  /** Retire une décision de la file, une fois le statut écrit en base. Non
   *  acquittée = conservée, et retentée à la prochaine synchro. */
  ackRideDecision(rideId: string): void;
  /** Met une décision prise DANS l'app dans cette même file, quand son écriture
   *  en base n'a pas abouti — course pas encore insérée, réseau coupé, session
   *  expirée. Elle y attend le prochain drain, comme celles tapées sur la carte
   *  ou la notification. Dédoublonné sur `rideId` côté natif. */
  queueRideDecision(rideId: string, status: 'ACCEPTED' | 'DECLINED'): void;
  /** Efface le verdict affiché sur la Live Activity / la notification de
   *  résultat, quand la décision a été prise DANS l'app. Sans effet si la carte
   *  montre déjà une autre course. */
  clearRideResult(rideId: string): void;
  /** Active/désactive le scanner. Android : démarre/arrête la bulle flottante.
   *  iOS : flag lu par la Share Extension + l'AppIntent (raccourci AssistiveTouch)
   *  → un scan déclenché alors que désactivé est refusé avec un message. */
  setScannerEnabled(enabled: boolean): void;
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
  /** Écoute les échecs (signal UI, sans motif) */
  onScanFailed(cb: () => void): { remove: () => void } | undefined;
  /** Écoute les échecs AVEC leur motif, pour la trace de diagnostic. Émis aussi
   *  pour les scans cassés pendant que le JS ne tournait pas : le natif les
   *  empile (App Group / SharedPreferences) et les vide à l'abonnement. */
  onScanFailure(
    cb: (f: { reason: string; surface: string; platform?: string | null; detail?: string | null; occurredAt?: number | null }) => void,
  ): { remove: () => void } | undefined;
  /** Trace de diagnostic Live Activity, telle que stockée côté natif.
   *  iOS uniquement — Android n'a pas de Live Activity, la trace y est vide. */
  getDiagnostics?(): Promise<{
    trace: string;
    lastStep: string;
    tracing: boolean;
    /** Combien de fois le système a demandé chaque présentation du Dynamic
     *  Island sur un état de résultat. Aucune API ne permet de savoir laquelle
     *  est à l'écran : le widget compte ses propres rendus, et c'est le seul
     *  signal disponible. Un compteur à 0 prouve l'absence ; un compteur haut
     *  est un majorant (SwiftUI peut évaluer une vue sans l'afficher).
     *  `since` = début de la fenêtre de mesure, en secondes epoch. */
    presentations?: { expanded: number; compact: number; minimal: number; since: number };
  }>;
  /** Redémarre une mesure propre des présentations. iOS uniquement. */
  resetPresentationCounters?(): void;
  /** Active ou coupe la collecte. Éteinte, rien n'est écrit sur l'appareil ;
   *  la couper efface aussi ce qui avait été collecté. */
  setDiagnosticsTracing?(enabled: boolean): void;
  clearDiagnostics?(): void;
  /** Écoute le refus de permission */
  onPermissionDenied(cb: () => void): { remove: () => void } | undefined;
}
