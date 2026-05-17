export type PlanTier = 'free' | 'plus' | 'premium';

export interface PlanLimits {
  dailyScans: number | null; // null = unlimited
  analyticsRangeDays: number | null; // null = unlimited
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { dailyScans: 3, analyticsRangeDays: 1 },
  plus: { dailyScans: 50, analyticsRangeDays: 7 },
  premium: { dailyScans: null, analyticsRangeDays: null },
};

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
  return PLAN_LIMITS[tier];
}

/** Returns remaining scans (null = unlimited). Counts extra credits after daily limit exhausted. */
export function getRemainingScans(
  tier: PlanTier,
  todayCount: number,
  extraCredits: number,
): number | null {
  const { dailyScans } = PLAN_LIMITS[tier];
  if (dailyScans === null) return null;
  // Clamp inputs : un compteur négatif ou NaN ne doit pas créditer de scans bonus.
  const safeToday = Number.isFinite(todayCount) ? Math.max(0, todayCount) : 0;
  const safeExtra = Number.isFinite(extraCredits) ? Math.max(0, extraCredits) : 0;
  const fromPlan = Math.max(0, dailyScans - safeToday);
  return fromPlan + safeExtra;
}

