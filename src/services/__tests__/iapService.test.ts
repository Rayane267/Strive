(global as any).__DEV__ = true;

jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('@env', () => ({
  REVENUECAT_API_KEY_ANDROID: 'test-android-key',
  REVENUECAT_API_KEY_IOS: 'test-ios-key',
}), { virtual: true });

import { IAP_PRODUCTS, PLUS_ENTITLEMENT, PREMIUM_ENTITLEMENT, isIAPAvailable } from '../iapService';

describe('iapService — constants', () => {
  it('exports subscription product identifiers', () => {
    expect(IAP_PRODUCTS.PLUS_MONTHLY).toBe('strive_plus_monthly');
    expect(IAP_PRODUCTS.PLUS_YEARLY).toBe('strive_plus_yearly');
    expect(IAP_PRODUCTS.PREMIUM_MONTHLY).toBe('strive_premium_monthly');
    expect(IAP_PRODUCTS.PREMIUM_YEARLY).toBe('strive_premium_yearly');
  });

  it('exports scan pack identifiers', () => {
    expect(IAP_PRODUCTS.SCAN_PACK_XS).toBe('strive_scan_pack_xs');
    expect(IAP_PRODUCTS.SCAN_PACK_S).toBe('strive_scan_pack_s');
    expect(IAP_PRODUCTS.SCAN_PACK_M).toBe('strive_scan_pack_m');
    expect(IAP_PRODUCTS.SCAN_PACK_L).toBe('strive_scan_pack_l');
  });

  it('exports entitlement identifiers', () => {
    expect(PLUS_ENTITLEMENT).toBe('plus');
    expect(PREMIUM_ENTITLEMENT).toBe('premium');
  });

  it('isIAPAvailable returns boolean', () => {
    expect(typeof isIAPAvailable()).toBe('boolean');
  });
});
