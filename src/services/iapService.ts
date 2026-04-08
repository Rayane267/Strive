/**
 * IAP Service — RevenueCat wrapper
 *
 * Setup required before this works:
 *  1. npm install react-native-purchases
 *  2. iOS:  cd ios && pod install
 *  3. Android: no extra steps (auto-linked)
 *  4. Create a RevenueCat account at revenuecat.com
 *  5. Add to .env:
 *       REVENUECAT_API_KEY_ANDROID=appl_xxxxxxxx
 *       REVENUECAT_API_KEY_IOS=appl_xxxxxxxx
 *  6. Create products in Google Play Console + App Store Connect
 *     with the identifiers defined in IAP_PRODUCTS below
 *  7. Add those products + entitlements in the RevenueCat dashboard
 */

import { Platform } from 'react-native';
import { supabase } from './supabase';
import { REVENUECAT_API_KEY_ANDROID, REVENUECAT_API_KEY_IOS } from '@env';

// ─── Product identifiers ───────────────────────────────────────────────────────
// These must match exactly what you create in:
//   - Google Play Console → Monetize → In-app products (consumable)
//   - App Store Connect → In-App Purchases (consumable)
//   - RevenueCat dashboard → Products
export const IAP_PRODUCTS = {
  SCAN_1:       'strive_scan_1',
  SCAN_3:       'strive_scan_3',
  SCAN_5:       'strive_scan_5',
  SCAN_10:      'strive_scan_10',
  PLUS_MONTHLY: 'strive_plus_monthly',
} as const;

// RevenueCat entitlement ID (configure in RevenueCat dashboard)
export const PLUS_ENTITLEMENT = 'plus';

// ─── Lazy-load RevenueCat (graceful fallback if package not installed) ─────────
let _Purchases: any = null;
function rc(): any {
  if (!_Purchases) {
    try {
      _Purchases = require('react-native-purchases').default;
    } catch {
      __DEV__ && console.warn('[IAP] react-native-purchases not installed. Run: npm install react-native-purchases');
    }
  }
  return _Purchases;
}

export function isIAPAvailable(): boolean {
  return rc() !== null;
}

// ─── Init ──────────────────────────────────────────────────────────────────────
let _initialized = false;

export function initPurchases(userId: string): void {
  const Purchases = rc();
  if (!Purchases) return;

  const apiKey = Platform.OS === 'ios'
    ? REVENUECAT_API_KEY_IOS
    : REVENUECAT_API_KEY_ANDROID;

  if (!apiKey) {
    __DEV__ && console.warn('[IAP] RevenueCat API key not set in .env');
    return;
  }

  if (_initialized) {
    Purchases.logIn(userId).catch(() => {});
    return;
  }

  try {
    const { LOG_LEVEL } = require('react-native-purchases');
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);
    Purchases.configure({ apiKey, appUserID: userId });
    _initialized = true;
  } catch (e) {
    __DEV__ && console.error('[IAP] configure error', e);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
async function getAllPackages(): Promise<Record<string, any>> {
  const Purchases = rc();
  if (!Purchases) throw new Error('IAP_NOT_AVAILABLE');
  const offerings = await Purchases.getOfferings();
  const map: Record<string, any> = {};
  for (const key of Object.keys(offerings.all)) {
    for (const pkg of offerings.all[key].availablePackages) {
      map[pkg.product.identifier] = pkg;
    }
  }
  return map;
}

function isPurchaseCancelledError(e: any): boolean {
  // RevenueCat throws PurchasesErrorCode 1 when user cancels
  return e?.code === '1' || e?.userCancelled === true;
}

// ─── Purchase scan pack (consumable) ──────────────────────────────────────────
export async function buyScanPack(
  productId: string,
  userId: string,
  quantity: number,
): Promise<void> {
  const Purchases = rc();
  if (!Purchases) throw new Error('IAP_NOT_AVAILABLE');

  const packages = await getAllPackages();
  const pkg = packages[productId];
  if (!pkg) throw new Error(`Product not found: ${productId}`);

  try {
    await Purchases.purchasePackage(pkg);
  } catch (e: any) {
    if (isPurchaseCancelledError(e)) throw new Error('CANCELLED');
    throw e;
  }

  // Optimistic DB update — RevenueCat webhook is the source of truth in production
  const { data } = await supabase
    .from('profiles')
    .select('extra_scan_credits')
    .eq('id', userId)
    .single();
  const current = (data?.extra_scan_credits as number) ?? 0;
  const { error } = await supabase
    .from('profiles')
    .update({ extra_scan_credits: current + quantity })
    .eq('id', userId);
  if (error) throw error;
}

// ─── Purchase Plus subscription ────────────────────────────────────────────────
export async function buyPlus(userId: string): Promise<void> {
  const Purchases = rc();
  if (!Purchases) throw new Error('IAP_NOT_AVAILABLE');

  const packages = await getAllPackages();
  const pkg = packages[IAP_PRODUCTS.PLUS_MONTHLY];
  if (!pkg) throw new Error(`Product not found: ${IAP_PRODUCTS.PLUS_MONTHLY}`);

  let customerInfo: any;
  try {
    ({ customerInfo } = await Purchases.purchasePackage(pkg));
  } catch (e: any) {
    if (isPurchaseCancelledError(e)) throw new Error('CANCELLED');
    throw e;
  }

  if (customerInfo?.entitlements?.active?.[PLUS_ENTITLEMENT]) {
    const { error } = await supabase
      .from('profiles')
      .update({ subscription_tier: 'plus' })
      .eq('id', userId);
    if (error) throw error;
  }
}

// ─── Restore purchases (required by App Store guidelines) ──────────────────────
export async function restorePurchases(userId: string): Promise<boolean> {
  const Purchases = rc();
  if (!Purchases) throw new Error('IAP_NOT_AVAILABLE');

  const customerInfo = await Purchases.restorePurchases();
  const hasPlus = !!customerInfo?.entitlements?.active?.[PLUS_ENTITLEMENT];

  if (hasPlus) {
    await supabase
      .from('profiles')
      .update({ subscription_tier: 'plus' })
      .eq('id', userId);
  }

  return hasPlus;
}

// ─── Get real price label from store (optional enhancement) ───────────────────
export async function getStorePrices(): Promise<Record<string, string>> {
  try {
    const packages = await getAllPackages();
    const prices: Record<string, string> = {};
    for (const [id, pkg] of Object.entries(packages)) {
      prices[id] = pkg.product?.priceString ?? '';
    }
    return prices;
  } catch {
    return {};
  }
}
