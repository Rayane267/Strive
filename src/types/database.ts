export type SubscriptionStatus =
  | 'active'
  | 'in_grace_period'
  | 'expired'
  | 'cancelled'
  | 'paused'
  | 'refunded';

export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;   // ISO : "YYYY-MM-DD"
  avatar_url?: string | null;
  is_online: boolean;
  // Subscription
  subscription_tier: 'free' | 'plus' | 'premium';
  subscription_status?: SubscriptionStatus | null;
  subscription_expires_at?: string | null;   // ISO timestamptz
  subscription_product_id?: string | null;
  extra_scan_credits: number;
  /** Pool de bienvenue — 30 scans offerts une fois par appareil à la sortie de
   *  l'onboarding. Distinct de `extra_scan_credits` parce qu'il périme, là où un
   *  crédit acheté ne doit jamais périmer. Consommé AVANT lui. */
  welcome_credits?: number | null;
  /** Péremption du pool de bienvenue. Porte deux informations : la date, et le
   *  fait que ce compte a déjà reçu son cadeau (non NULL = servi). Passé cette
   *  date, `welcome_credits` ne vaut plus rien — la colonne n'est pas remise à
   *  zéro pour autant, ni ici ni côté serveur. */
  welcome_credits_expires_at?: string | null;   // ISO timestamptz
  /** Scans consommés dans la journée de travail en cours. Écrit UNIQUEMENT par
   *  le trigger `check_scan_quota`, et en lecture seule côté client — c'est la
   *  valeur sur laquelle le serveur applique le quota, donc celle que l'écran
   *  doit afficher. */
  daily_scans_count?: number | null;
  /** Borne de la journée à laquelle se rapporte `daily_scans_count` (TZ du
   *  chauffeur + `day_reset_hour`). Si elle est antérieure au début de la
   *  journée courante, le compteur est périmé et vaut 0 — c'est ce qui remplace
   *  une remise à zéro planifiée. */
  daily_scans_day?: string | null;   // ISO timestamptz
  /** Fuseau IANA du téléphone (ex. "Europe/Paris") — sert au reset du quota à
   *  minuit local. Synchronisé depuis le Dashboard, uniquement s'il a changé. */
  timezone?: string | null;
  // Admin
  is_admin?: boolean;
  // Véhicule (CarSettingsScreen)
  car_make?: string | null;
  car_model?: string | null;
  car_year?: string | null;
  car_reg?: string | null;
  fuel_type?: string | null;
  avg_cons?: number | null;
  /** Prix €/kWh personnalisé (véhicule électrique). null → repli DEFAULT_FUEL_PRICE.electric. */
  elec_price?: number | null;
}

export interface Ride {
  id: string;
  user_id: string;
  platform: 'UBER' | 'BOLT' | 'HEETCH';
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  fare_estimated: number;
  fare_final: number | null;
  distance_km: number;
  duration_min: number;
  hourly_rate: number;
  km_rate: number;
  fuel_cost?: number | null;    // coût carburant figé au scan
  net_profit?: number | null;   // tarif − fuel_cost (net réel daté)
  pickup_address?: string | null;
  destination_address?: string | null;
  /**
   * Horodatage du SCAN (epoch secondes), clé de corrélation avec les décisions
   * « Prise / Refusée » tapées hors de l'app (Live Activity, notification, Siri).
   * `created_at` ne peut pas jouer ce rôle : c'est l'heure d'insertion, qui peut
   * arriver des heures après le scan quand l'app était fermée.
   * `null` pour les courses créées avant la migration 20260816_rides_scan_ts.
   */
  scan_ts?: number | null;
  created_at: string;
}
