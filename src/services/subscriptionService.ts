import { supabase } from './supabase';

export type PlanTier = 'free' | 'plus' | 'premium';

export interface PlanLimits {
  dailyScans: number | null; // null = unlimited
  analyticsRangeDays: number | null; // null = unlimited
}

// Fallback hardcodé — utilisé tant que `fetchPlanLimits()` n'a pas répondu
// (1er démarrage offline, DB injoignable, etc.). La table Supabase
// `plan_limits` est la source de vérité finale ; ces valeurs sont là pour
// garder une UX correcte en degraded mode.
const FALLBACK_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { dailyScans: 3, analyticsRangeDays: 1 },
  plus: { dailyScans: 30, analyticsRangeDays: 7 },
  premium: { dailyScans: null, analyticsRangeDays: null },
};

/**
 * Seuils de rentabilité imposés au tier free (non personnalisables).
 * La personnalisation des seuils est un avantage Plus → on force ces valeurs
 * basiques pour les comptes free, où qu'ils soient lus.
 *
 * ⚠️ DOIT rester égal au preset `casual` de TutorialScreen (« Débutant ») :
 * c'est le réglage que le compte gratuit subit, et le tuto le lui présente.
 * Les deux avaient divergé (tuto 20 / 0,80 vs appliqué 25 / 1,20), donc le
 * chauffeur voyait des verdicts sans rapport avec ce qu'il avait choisi.
 */
export const FREE_THRESHOLDS = { hourly: 25, km: 1.10 } as const;

// Cache mémoire des limites fetched depuis la DB. Préchauffé au démarrage
// via `fetchPlanLimits()` ; getPlanLimits() lit ce cache en priorité.
let _runtimeLimits: Record<PlanTier, PlanLimits> | null = null;

/** @deprecated Conservé pour compat — préfère getPlanLimits(tier) qui lit le runtime. */
export const PLAN_LIMITS = FALLBACK_LIMITS;

/**
 * Fetch les limites depuis Supabase et les met en cache mémoire.
 * À appeler au démarrage (AuthContext) et à chaque refresh profil.
 * Silencieux : si fetch échoue, on garde le fallback.
 */
export async function fetchPlanLimits(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('plan_limits')
      .select('tier, daily_scans');
    if (error || !data) return;

    const next = { ...FALLBACK_LIMITS };
    for (const row of data as Array<{ tier: string; daily_scans: number | null }>) {
      if (row.tier === 'free' || row.tier === 'plus' || row.tier === 'premium') {
        next[row.tier] = {
          dailyScans: row.daily_scans,
          // analyticsRangeDays n'a pas de colonne dédiée en DB, mais il EST lu
          // (Analytics et Historique bornent la sélection du calendrier dessus,
          // via getMaxRangeSpanDays). Ce repli est donc sa seule source de vérité.
          analyticsRangeDays: FALLBACK_LIMITS[row.tier].analyticsRangeDays,
        };
      }
    }
    _runtimeLimits = next;
  } catch {
    // Fail-silent : on garde le fallback
  }
}

// Doit rester synchro avec public.subscription_products (seed migration).
// quantity/price/priceLabel sont des fallbacks UI — la source de vérité finale
// est le store (priceString via getStorePrices) + scan_credits en DB.
export const SCAN_PACKS = [
  { id: 'pack_xs', productId: 'strive_scan_pack_xs', quantity: 1,  price: 0.49, priceLabel: '0,49€' },
  { id: 'pack_s',  productId: 'strive_scan_pack_s',  quantity: 3,  price: 0.99, priceLabel: '0,99€', savings: '-32%' },
  { id: 'pack_m',  productId: 'strive_scan_pack_m',  quantity: 5,  price: 1.49, priceLabel: '1,49€', savings: '-39%' },
  { id: 'pack_l',  productId: 'strive_scan_pack_l',  quantity: 10, price: 2.49, priceLabel: '2,49€', savings: '-49%' },
] as const;

export function getPlanTier(tier?: string | null): PlanTier {
  if (tier === 'plus') return 'plus';
  if (tier === 'premium' || tier === 'pro') return 'premium';
  return 'free';
}

/**
 * Période de grâce Apple/Google : quand un paiement échoue, le store ne coupe
 * pas, il réessaie — jusqu'à 16 jours côté Apple. L'abonné garde son accès
 * pendant ce temps. Le plafond sert de garde-fou : si l'event EXPIRATION se
 * perdait, l'accès ne resterait pas ouvert indéfiniment.
 * À garder en phase avec enforce_scan_quota (20260727_billing_grace_period.sql).
 */
export const GRACE_PERIOD_DAYS = 16;

/**
 * Comme getPlanTier mais retourne 'free' si l'abonnement est expiré.
 * Garde-fou côté client si le webhook RC a raté l'event EXPIRATION.
 *
 * Exception : `in_grace_period`. La RPC conserve déjà le tier sur BILLING_ISSUE,
 * mais sans cette lecture du statut on dégradait quand même l'utilisateur dès
 * que la date passait — c'est-à-dire pendant qu'Apple réessaie encore sa carte.
 */
export function getEffectivePlanTier(profile?: {
  subscription_tier?: string | null;
  subscription_expires_at?: string | null;
  subscription_status?: string | null;
} | null): PlanTier {
  if (!profile) return 'free';
  const tier = getPlanTier(profile.subscription_tier);
  if (tier === 'free') return 'free';
  if (profile.subscription_expires_at) {
    const exp = new Date(profile.subscription_expires_at).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) {
      const graceEnd = exp + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
      const inGrace = profile.subscription_status === 'in_grace_period'
        && Date.now() < graceEnd;
      if (!inGrace) return 'free';
    }
  }
  return tier;
}

export function getPlanLimits(tier: PlanTier): PlanLimits {
  return (_runtimeLimits ?? FALLBACK_LIMITS)[tier];
}

/**
 * Écart maximal, en jours, entre les deux bornes d'une sélection au calendrier.
 * `null` = aucune borne (Premium).
 *
 * Le -1 n'est pas une marge : `analyticsRangeDays` compte des journées, une
 * sélection compte l'intervalle qui les sépare. 7 jours d'historique, ce sont
 * bien 6 jours d'écart entre le premier et le dernier — du lundi au dimanche.
 */
export function getMaxRangeSpanDays(tier: PlanTier): number | null {
  const days = getPlanLimits(tier).analyticsRangeDays;
  return days === null ? null : Math.max(0, days - 1);
}

/**
 * Crédits de bienvenue encore valides sur ce profil, 0 si le pool a périmé.
 *
 * Miroir exact du test de `enforce_scan_quota` (20260830_welcome_credits.sql) :
 * le serveur ne remet PAS la colonne à zéro à l'expiration — c'est la date qui
 * la rend inerte. Lire `welcome_credits` sans passer par ici afficherait donc un
 * solde que le serveur refuserait de consommer.
 */
export function getWelcomeCredits(profile?: {
  welcome_credits?: number | null;
  welcome_credits_expires_at?: string | null;
} | null): number {
  if (!profile?.welcome_credits) return 0;
  const exp = profile.welcome_credits_expires_at;
  if (!exp) return 0;
  const ts = new Date(exp).getTime();
  if (Number.isNaN(ts) || ts <= Date.now()) return 0;
  return Math.max(0, profile.welcome_credits);
}

/**
 * Returns remaining scans (null = unlimited).
 * Ordre de consommation, aligné sur `enforce_scan_quota` : quota journalier,
 * puis crédits de bienvenue (ils périment), puis crédits achetés.
 * `welcomeCredits` est optionnel — les appelants antérieurs au pool de
 * bienvenue restent justes, ils comptent simplement un pool de moins.
 */
export function getRemainingScans(
  tier: PlanTier,
  todayCount: number,
  extraCredits: number,
  welcomeCredits: number = 0,
): number | null {
  const { dailyScans } = getPlanLimits(tier);
  if (dailyScans === null) return null;
  // Clamp inputs : un compteur négatif ou NaN ne doit pas créditer de scans bonus.
  const safeToday = Number.isFinite(todayCount) ? Math.max(0, todayCount) : 0;
  const safeExtra = Number.isFinite(extraCredits) ? Math.max(0, extraCredits) : 0;
  const safeWelcome = Number.isFinite(welcomeCredits) ? Math.max(0, welcomeCredits) : 0;
  const fromPlan = Math.max(0, dailyScans - safeToday);
  return fromPlan + safeWelcome + safeExtra;
}

