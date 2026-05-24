import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { REVENUECAT_API_KEY_ANDROID, REVENUECAT_API_KEY_IOS } from '@env';

// ─── Product identifiers ───────────────────────────────────────────────────────
// Doit rester synchro avec public.subscription_products en DB.
// La DB est la source de vérité finale (le webhook met à jour profiles via lookup).
export const IAP_PRODUCTS = {
  // Subscriptions
  PLUS_MONTHLY:    'strive_plus_monthly',
  PLUS_YEARLY:     'strive_plus_yearly',
  PREMIUM_MONTHLY: 'strive_premium_monthly',
  PREMIUM_YEARLY:  'strive_premium_yearly',
  // Consumables (packs scans)
  SCAN_PACK_XS:    'strive_scan_pack_xs',  // 1 scan
  SCAN_PACK_S:     'strive_scan_pack_s',   // 3 scans
  SCAN_PACK_M:     'strive_scan_pack_m',   // 5 scans
  SCAN_PACK_L:     'strive_scan_pack_l',   // 10 scans
} as const;

// Entitlements RC (à configurer dans RC dashboard)
export const PLUS_ENTITLEMENT = 'plus';
export const PREMIUM_ENTITLEMENT = 'premium';

// Note : le caller (SubscriptionScreen, ShopScreen) doit utiliser
// waitForProfileUpdate de profileService après chaque achat pour attendre
// que le webhook RC ait propagé l'update en DB.

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
    Purchases.logIn(userId).catch((e: any) => {
      Sentry.addBreadcrumb({ category: 'iap', message: `logIn failed: ${e?.message ?? e}`, level: 'warning' });
    });
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

// ─── Purchase consumable pack (scans) ─────────────────────────────────────────
// Le webhook RC reçoit NON_RENEWING_PURCHASE → apply_revenuecat_event
// → incrémente profiles.extra_scan_credits selon scan_credits du SKU en DB.
// Pas d'UPDATE direct côté client (bloqué par le trigger anti-tampering).
export async function buyScanPack(productId: string): Promise<void> {
  const Purchases = rc();
  if (!Purchases) throw new Error('IAP_NOT_AVAILABLE');

  const packages = await getAllPackages();
  const pkg = packages[productId];
  if (!pkg) throw new Error(`Product not found: ${productId}`);

  try {
    await Purchases.purchasePackage(pkg);
    Sentry.addBreadcrumb({ category: 'iap', message: `Purchased ${productId}`, level: 'info' });
  } catch (e: any) {
    if (isPurchaseCancelledError(e)) throw new Error('CANCELLED');
    Sentry.captureException(e, { tags: { flow: 'iap_purchase', productId } });
    throw e;
  }
}

// ─── Purchase subscription (Plus / Premium) ───────────────────────────────────
// Le webhook RC reçoit INITIAL_PURCHASE → apply_revenuecat_event
// → met à jour profiles.subscription_tier selon le mapping en DB.
export async function buySubscription(productId: string): Promise<{ entitlement: string | null }> {
  const Purchases = rc();
  if (!Purchases) throw new Error('IAP_NOT_AVAILABLE');

  const packages = await getAllPackages();
  const pkg = packages[productId];
  if (!pkg) throw new Error(`Product not found: ${productId}`);

  let customerInfo: any;
  try {
    ({ customerInfo } = await Purchases.purchasePackage(pkg));
  } catch (e: any) {
    if (isPurchaseCancelledError(e)) throw new Error('CANCELLED');
    throw e;
  }

  const active = customerInfo?.entitlements?.active ?? {};
  if (active[PREMIUM_ENTITLEMENT]) return { entitlement: PREMIUM_ENTITLEMENT };
  if (active[PLUS_ENTITLEMENT]) return { entitlement: PLUS_ENTITLEMENT };
  return { entitlement: null };
}

// Backcompat : conserve l'ancienne signature buyPlus utilisée par SubscriptionScreen.
// productId par défaut = monthly (anciens callers). Le nouveau paywall passe yearly/monthly explicitement.
export async function buyPlus(_userId: string, productId: string = IAP_PRODUCTS.PLUS_MONTHLY): Promise<void> {
  await buySubscription(productId);
}

// ─── Plus packages (monthly + yearly) avec prix réels du store ────────────────
export type PlusPackage = {
  productId: string;
  priceString: string;            // ex: "9,99 €" — formaté par le store local
  pricePerMonthString?: string;   // pour yearly : ex: "6,67 €" (price/12, format local)
  rawPrice: number;               // valeur numérique pour calculs (économies, etc.)
  currencyCode: string;
};

export async function getPlusPackages(): Promise<{ monthly: PlusPackage | null; yearly: PlusPackage | null }> {
  const Purchases = rc();
  if (!Purchases) return { monthly: null, yearly: null };

  try {
    const packages = await getAllPackages();
    const toPackage = (productId: string, isYearly: boolean): PlusPackage | null => {
      const pkg = packages[productId];
      if (!pkg?.product) return null;
      const p = pkg.product;
      const out: PlusPackage = {
        productId,
        priceString: p.priceString ?? '',
        rawPrice: typeof p.price === 'number' ? p.price : 0,
        currencyCode: p.currencyCode ?? 'EUR',
      };
      if (isYearly && out.rawPrice > 0) {
        // Format le prix mensuel équivalent avec la locale courante.
        try {
          const formatter = new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: out.currencyCode,
            maximumFractionDigits: 2,
          });
          out.pricePerMonthString = formatter.format(out.rawPrice / 12);
        } catch {
          out.pricePerMonthString = `${(out.rawPrice / 12).toFixed(2)} ${out.currencyCode}`;
        }
      }
      return out;
    };
    return {
      monthly: toPackage(IAP_PRODUCTS.PLUS_MONTHLY, false),
      yearly: toPackage(IAP_PRODUCTS.PLUS_YEARLY, true),
    };
  } catch {
    return { monthly: null, yearly: null };
  }
}

// ─── Trial eligibility (per product) ──────────────────────────────────────────
// Apple : 1 essai par "subscription group" par compte iCloud. Donc si l'user a
// déjà testé Plus monthly, il sera inéligible aussi pour Plus yearly (même groupe).
// Renvoie un map productId → boolean. En cas d'erreur ou RC indispo, renvoie {} (= traité comme non éligible).
export async function checkTrialEligibility(productIds: string[]): Promise<Record<string, boolean>> {
  const Purchases = rc();
  if (!Purchases || productIds.length === 0) return {};
  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds);
    const out: Record<string, boolean> = {};
    // RC enum: 0=unknown, 1=ineligible, 2=eligible, 3=no_intro_offer
    for (const id of productIds) {
      const status = result?.[id]?.status;
      out[id] = status === 2;
    }
    return out;
  } catch {
    return {};
  }
}

// ─── Restore purchases (obligatoire pour validation App Store) ────────────────
// Renvoie true si au moins un entitlement actif est trouvé. Le webhook RC reçoit
// les events de restore et met à jour la DB.
const RESTORE_TIMEOUT_MS = 15_000;

export async function restorePurchases(_userId?: string): Promise<boolean> {
  const Purchases = rc();
  if (!Purchases) throw new Error('IAP_NOT_AVAILABLE');

  try {
    const customerInfo = await Promise.race([
      Purchases.restorePurchases(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('RESTORE_TIMEOUT')), RESTORE_TIMEOUT_MS),
      ),
    ]);
    const active = customerInfo?.entitlements?.active ?? {};
    const hasEntitlement = !!active[PLUS_ENTITLEMENT] || !!active[PREMIUM_ENTITLEMENT];
    Sentry.addBreadcrumb({ category: 'iap', message: `Restore done (active=${hasEntitlement})`, level: 'info' });
    return hasEntitlement;
  } catch (e: any) {
    Sentry.captureException(e, { tags: { flow: 'iap_restore' } });
    throw e;
  }
}

// ─── Logout RC (à appeler au signOut Supabase pour éviter les fuites cross-comptes) ─
export async function logoutPurchases(): Promise<void> {
  const Purchases = rc();
  if (!Purchases) return;
  try {
    await Purchases.logOut();
  } catch (e: any) {
    // Logout RC throw si pas connecté — pas grave, mais on log pour repérer
    // les vrais bugs (ex: token corrompu, network erreur).
    Sentry.addBreadcrumb({ category: 'iap', message: `logOut error: ${e?.message ?? e}`, level: 'info' });
  }
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
