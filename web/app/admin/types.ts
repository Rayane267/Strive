export type Status = 'open' | 'answered' | 'closed';

export interface Ticket {
  id: string;
  user_email: string | null;
  subject: string;
  status: Status;
  created_at: string;
  last_message_at: string;
}

export interface Msg {
  id: string;
  ticket_id: string;
  sender: 'user' | 'staff';
  body: string;
  created_at: string;
}

export const STATUS: Record<Status, { label: string; color: string }> = {
  open:     { label: 'À traiter', color: '#FFB300' },
  answered: { label: 'Répondu',   color: '#00E676' },
  closed:   { label: 'Fermé',     color: '#6B7280' },
};

export const fmt = (s: string) =>
  new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Forme renvoyée par le RPC `admin_analytics` (cf. migration 20260916). */
export interface Analytics {
  generated_at: string;
  window_days: number;
  users: { total: number; new_7d: number; new_30d: number; new_window: number };
  active_users: { window: number; d7: number };
  subscriptions: {
    free: number; plus: number; premium: number;
    active: number; grace: number; cancelled: number;
  };
  scans: {
    total: number; both_addresses: number; gemini_fallback: number;
    verdict_good: number; verdict_mid: number; verdict_bad: number;
  };
  scans_by_platform: { platform: string; total: number; both_addresses: number; fallback: number }[];
  scans_daily: { day: string; total: number; fallback: number }[];
  rides: {
    total: number; accepted: number; declined: number;
    avg_hourly_rate: number | null; avg_fare: number | null;
  };
  sessions: { total: number; total_hours: number; avg_hours: number };
  support: { open: number; answered: number; closed: number; new_window: number };
  support_first_reply_minutes: number | null;
}

/* ──────────────────────────────────────────────────────────────────────────
   Console chauffeurs — formes renvoyées par les RPC de la migration
   20260916_admin_drivers.sql. Toutes sont gardées par `is_admin()` côté base.
   ────────────────────────────────────────────────────────────────────────── */

export type Tier = 'free' | 'plus' | 'premium';

export const TIER: Record<Tier, { label: string; color: string }> = {
  free:    { label: 'Gratuit', color: '#6B7280' },
  plus:    { label: 'Plus',    color: '#00E676' },
  premium: { label: 'Premium', color: '#3987e5' },
};

/** `admin_live()` — instantané des sessions ouvertes. */
export interface Live {
  generated_at: string;
  counts: {
    /** Sessions `online_sessions` sans `end_at` : la définition qui fait foi. */
    sessions_open: number;
    /** Ouvertes depuis plus de 16 h : l'app a été tuée sans refermer. */
    stale: number;
    /** `profiles.is_online` — le drapeau, qui peut mentir. */
    flag_online: number;
    /** Drapeau levé sans session ouverte : l'écart entre les deux. */
    incoherent: number;
  };
  drivers: LiveDriver[];
}

export interface LiveDriver {
  id: string;
  email: string | null;
  name: string | null;
  tier: Tier;
  country: string | null;
  flag_online: boolean;
  since: string;
  minutes: number;
  stale: boolean;
  scans_today: number;
  rides_today: number;
  last_ride_at: string | null;
}

/** `admin_drivers(...)` — une page de la liste. */
export interface DriversPage {
  total: number;
  limit: number;
  offset: number;
  rows: DriverRow[];
}

export interface DriverRow {
  id: string;
  email: string | null;
  name: string | null;
  tier: Tier;
  status: string | null;
  country: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  last_seen: string | null;
  is_online: boolean;
  session_since: string | null;
  expires_at: string | null;
  scans_today: number;
  daily_scans_day: string | null;
  credits: number;
  welcome_credits: number;
  welcome_expires_at: string | null;
  scans_7d: number;
  scans_30d: number;
  rides_30d: number;
  accepted_30d: number;
  hours_30d: number | null;
  /** Consolidé en euros au taux figé de chaque course, pas une somme brute. */
  earnings_30d_eur: number | null;
  avg_hourly_eur: number | null;
  tickets_open: number;
}

/** `admin_driver(uuid)` — la fiche. */
export interface DriverDetail {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  country: string | null;
  timezone: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  subscription: {
    tier: Tier;
    status: string | null;
    expires_at: string | null;
    product_id: string | null;
  };
  quota: {
    scans_today: number;
    day: string | null;
    /** Compteur périmé : sa borne de journée est antérieure à aujourd'hui. */
    stale: boolean;
    credits: number;
    welcome_credits: number;
    welcome_expires_at: string | null;
  };
  vehicle: {
    make: string | null; model: string | null; year: string | null;
    fuel_type: string | null; avg_cons: number | null;
  };
  online: { flag: boolean; since: string | null };
  activity_30d: {
    scans: number; rides: number; accepted: number;
    hours: number | null; earnings_eur: number | null;
  };
  daily: { day: string; scans: number; rides: number }[];
  recent_rides: {
    created_at: string;
    platform: string | null;
    status: string;
    fare_estimated: number | null;
    fare_final: number | null;
    currency: string | null;
    hourly_rate: number | null;
    km_rate: number | null;
    distance_km: number | null;
    duration_min: number | null;
  }[];
  tickets: { id: string; subject: string; status: Status; created_at: string; last_message_at: string }[];
}

/** « il y a 3 h », « il y a 12 j » — l'écart lu d'un coup d'œil. */
export const ago = (iso: string | null) => {
  if (!iso) return 'jamais';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `il y a ${d} j` : `il y a ${Math.floor(d / 30)} mois`;
};

/** Durée en minutes → « 3 h 20 ». */
export const dur = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};

export const eur = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toFixed(2).replace('.', ',')} €`;

/* ──────────────────────────────────────────────────────────────────────────
   `admin_feed(...)` — les flux récents (migration 20260916_admin_feed.sql).
   ────────────────────────────────────────────────────────────────────────── */

export interface Feed {
  generated_at: string;
  window_days: number;
  subs_recent: SubEvent[];
  subs_by_type: { event_type: string; total: number }[];
  subs_active_by_product: { product_id: string; tier: Tier; total: number }[];
  subs_expiring: {
    user_id: string; email: string | null; tier: Tier;
    status: string | null; expires_at: string;
  }[];
  failures_recent: Failure[];
  failures_by_reason: { reason: string; total: number }[];
  failures_by_version: { app_version: string; total: number; users: number }[];
  failures_daily: { day: string; failures: number; scans: number }[];
  /** Part des tentatives qui échouent, en %. Null si aucune tentative. */
  failure_rate: number | null;
  audit_recent: { created_at: string; action: string; details: unknown; email: string | null }[];
  signups_daily: { day: string; signups: number }[];
  activation: { signups: number; scanned: number; rode: number; paid: number };
  waitlist: { total: number; window: number };
}

export interface SubEvent {
  created_at: string;
  user_id: string | null;
  email: string | null;
  event_type: string | null;
  product_id: string | null;
  status: string | null;
  expires_at: string | null;
  tier_now: Tier;
}

export interface Failure {
  at: string;
  reason: string;
  os: string | null;
  surface: string | null;
  platform: string | null;
  detail: string | null;
  app_version: string | null;
  email: string | null;
}

/** Les treize motifs normalisés par le RPC d'écriture (20260908_scan_failures).
 *  Tout le reste tombe sur `other`, le brut étant conservé dans `detail`.
 *  `blame` dit qui est en cause : ce qui vient de l'app se corrige, ce qui
 *  vient du chauffeur ou de la capture ne se corrige pas de la même façon. */
export const FAILURE: Record<string, { label: string; blame: 'app' | 'user' | 'source' }> = {
  scanner_off:     { label: 'Scanner coupé',            blame: 'user' },
  session_off:     { label: 'Pas de session',           blame: 'user' },
  quota_reached:   { label: 'Quota atteint',            blame: 'user' },
  invalid_image:   { label: 'Capture illisible',        blame: 'source' },
  throttled:       { label: 'Double appui',             blame: 'user' },
  ocr_empty:       { label: 'OCR vide',                 blame: 'app' },
  not_a_ride:      { label: 'Pas une offre',            blame: 'source' },
  gemini_ko:       { label: 'Gemini indisponible',      blame: 'app' },
  no_addresses:    { label: 'Aucune adresse lue',       blame: 'app' },
  la_start_failed: { label: 'Live Activity refusée',    blame: 'app' },
  expired:         { label: 'Reprise par le système',   blame: 'app' },
  timeout:         { label: 'Délai dépassé',            blame: 'app' },
  other:           { label: 'Autre',                    blame: 'app' },
};

/** Libellés des événements RevenueCat. `tone` colore la lecture : une
 *  annulation n'est pas un incident, un problème de paiement si. */
export const SUB_EVENT: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'flat' }> = {
  INITIAL_PURCHASE:     { label: 'Premier achat',        tone: 'good' },
  RENEWAL:              { label: 'Renouvellement',       tone: 'good' },
  PRODUCT_CHANGE:       { label: 'Changement de palier', tone: 'flat' },
  UNCANCELLATION:       { label: 'Annulation annulée',   tone: 'good' },
  CANCELLATION:         { label: 'Résiliation',          tone: 'warn' },
  EXPIRATION:           { label: 'Expiration',           tone: 'warn' },
  BILLING_ISSUE:        { label: 'Problème de paiement', tone: 'bad' },
  REFUND:               { label: 'Remboursement',        tone: 'bad' },
  SUBSCRIPTION_PAUSED:  { label: 'Abonnement en pause',  tone: 'warn' },
  TRANSFER:             { label: 'Transfert de compte',  tone: 'flat' },
  NON_RENEWING_PURCHASE:{ label: 'Achat ponctuel',       tone: 'good' },
};

/* ──────────────────────────────────────────────────────────────────────────
   Navigation. L'accueil est une grille de tuiles en couleur pleine ; chaque
   tuile ouvre SA page. La teinte suit la page jusque dans son en-tête, de
   sorte qu'on sait toujours d'où l'on vient.
   ────────────────────────────────────────────────────────────────────────── */

export type View = 'home' | 'drivers' | 'tickets' | 'subs' | 'errors' | 'activity';

export const VIEWS: Record<Exclude<View, 'home'>, { title: string; sub: string }> = {
  drivers:  { title: 'Chauffeurs',  sub: 'Le parc, palier par palier' },
  tickets:  { title: 'Support',     sub: 'Les fils de discussion' },
  errors:   { title: 'Erreurs',     sub: 'Ce que le scanner n’a pas réussi à lire' },
  subs:     { title: 'Abonnements', sub: 'Mouvements, échéances et revenu' },
  activity: { title: 'Activité',    sub: 'Scans, courses et heures en ligne' },
};
