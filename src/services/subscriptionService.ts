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
  plus: { dailyScans: 15, analyticsRangeDays: 7 },
  premium: { dailyScans: null, analyticsRangeDays: null },
};

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
 * Comme getPlanTier mais retourne 'free' si l'abonnement est expiré.
 * Garde-fou côté client si le webhook RC a raté l'event EXPIRATION.
 */
export function getEffectivePlanTier(profile?: {
  subscription_tier?: string | null;
  subscription_expires_at?: string | null;
} | null): PlanTier {
  if (!profile) return 'free';
  const tier = getPlanTier(profile.subscription_tier);
  if (tier === 'free') return 'free';
  if (profile.subscription_expires_at) {
    const exp = new Date(profile.subscription_expires_at).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) return 'free';
  }
  return tier;
}

export function getPlanLimits(tier: PlanTier): PlanLimits {
  return (_runtimeLimits ?? FALLBACK_LIMITS)[tier];
}

/** Returns remaining scans (null = unlimited). Counts extra credits after daily limit exhausted. */
export function getRemainingScans(
  tier: PlanTier,
  todayCount: number,
  extraCredits: number,
): number | null {
  const { dailyScans } = getPlanLimits(tier);
  if (dailyScans === null) return null;
  // Clamp inputs : un compteur négatif ou NaN ne doit pas créditer de scans bonus.
  const safeToday = Number.isFinite(todayCount) ? Math.max(0, todayCount) : 0;
  const safeExtra = Number.isFinite(extraCredits) ? Math.max(0, extraCredits) : 0;
  const fromPlan = Math.max(0, dailyScans - safeToday);
  return fromPlan + safeExtra;
}

