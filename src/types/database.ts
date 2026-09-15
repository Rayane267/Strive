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
  /** Pays d'activité (ISO 3166-1 alpha-2) — décide de la devise, de l'unité de
   *  distance, de la ligne de `fuel_prices` et du régime de cotisations. Voir
   *  `utils/market.ts`. null = pas encore connu, l'app retombe sur la région de
   *  l'appareil. Ce n'est PAS la langue : `fr` ne sépare pas la France de la
   *  Belgique ni de la Suisse. */
  country?: string | null;
  // Admin
  is_admin?: boolean;
  // Véhicule (CarSettingsScreen)
  car_make?: string | null;
  car_model?: string | null;
  car_year?: string | null;
  car_reg?: string | null;
  fuel_type?: string | null;
  avg_cons?: number | null;
  /** Prix du kWh saisi par le chauffeur (véhicule électrique). null → repli
   *  `DEFAULT_FUEL_PRICE.electric`. */
  elec_price?: number | null;
  /** Prix au litre saisi par le chauffeur. Prime sur la table `fuel_prices`, et
   *  c'est la SEULE source hors de France, où aucun relevé n'alimente la table
   *  (`market.fuelKey === null`). */
  fuel_price?: number | null;
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
  /**
   * Devise dans laquelle cette course a été gagnée.
   *
   * FIGÉE À LA CRÉATION. Changer de marché ne la réécrit pas : le chauffeur a
   * encaissé 20 €, pas £17,20, et c'est le premier chiffre qu'il compare à son
   * relevé bancaire. Sans cette colonne, basculer en livres ne convertissait
   * rien — ça RÉINTERPRÉTAIT tout l'historique, en silence.
   *
   * `undefined` sur les courses antérieures à la migration 20260915 : elles
   * sont alors lues comme des euros, ce qu'elles étaient toutes.
   */
  currency?: 'EUR' | 'CHF' | 'GBP' | null;
  /**
   * Unités de `currency` pour 1 EUR, FIGÉES AU SCAN.
   *
   * Sans elle, un total consolidé se recalculerait au taux du jour et
   * changerait tout seul : « 2 340 € ce mois-ci » devenait 2 358 € la semaine
   * suivante sans que le chauffeur ait roulé. Figée, la valeur pivot de chaque
   * course ne bouge plus jamais.
   *
   * `null` sur les courses antérieures à la migration : elles étaient toutes en
   * euros, donc le taux vaut 1 et se déduit.
   */
  fx_rate_eur?: number | null;
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
  /**
   * Horodatage du geste du chauffeur (« Prise » / « Refusée »).
   *
   * `null` ne veut pas dire « pas encore décidée » : il veut dire « aucune
   * décision explicite ». Une course clôturée par `close_pending_rides()` finit
   * en `DECLINED` avec `decided_at` à `null` — c'est ce qui permet de séparer
   * un refus d'un simple silence de fin de semaine.
   *
   * Écrite UNIQUEMENT par le trigger serveur `stamp_ride_decision` : ce que le
   * client envoie dans cette colonne est ignoré. En lecture seule côté app.
   *
   * `null` aussi sur tout l'historique antérieur au 07/09/2026 — la donnée
   * n'était pas enregistrée, et on ne l'a pas reconstituée.
   */
  decided_at?: string | null;   // ISO timestamptz
  created_at: string;
}
