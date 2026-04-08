import { supabase } from './supabase';

export type PlanTier = 'free' | 'plus' | 'premium';

export interface PlanLimits {
  dailyScans: number | null; // null = unlimited
  analyticsRangeDays: number | null; // null = unlimited
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { dailyScans: 1, analyticsRangeDays: 1 },
  plus: { dailyScans: 50, analyticsRangeDays: 7 },
  premium: { dailyScans: null, analyticsRangeDays: null },
};

export const SCAN_PACKS = [
  { id: 'scan_1',  productId: 'strive_scan_1',  quantity: 1,  price: 0.49, priceLabel: '0,49€' },
  { id: 'scan_3',  productId: 'strive_scan_3',  quantity: 3,  price: 0.99, priceLabel: '0,99€', savings: '-32%' },
  { id: 'scan_5',  productId: 'strive_scan_5',  quantity: 5,  price: 1.49, priceLabel: '1,49€', savings: '-39%' },
  { id: 'scan_10', productId: 'strive_scan_10', quantity: 10, price: 2.49, priceLabel: '2,49€', savings: '-49%' },
] as const;

export function getPlanTier(tier?: string | null): PlanTier {
  if (tier === 'plus') return 'plus';
  if (tier === 'premium' || tier === 'pro') return 'premium';
  return 'free';
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
  const fromPlan = Math.max(0, dailyScans - todayCount);
  return fromPlan + extraCredits;
}

/**
 * Adds scan credits to user profile.
 * TODO: In production, this should be triggered server-side after payment validation
 * (RevenueCat webhook, Stripe webhook, or App Store server notification).
 */
export async function addScanCredits(userId: string, amount: number): Promise<void> {
  const { data: current, error: fetchError } = await supabase
    .from('profiles')
    .select('extra_scan_credits')
    .eq('id', userId)
    .single();

  if (fetchError) throw fetchError;

  const currentCredits = (current?.extra_scan_credits as number) ?? 0;

  const { error } = await supabase
    .from('profiles')
    .update({ extra_scan_credits: currentCredits + amount })
    .eq('id', userId);

  if (error) throw error;
}
