const mockRpc = jest.fn();
jest.mock('../supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { fareBucket, logScanEvent } from '../telemetryService';

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockReturnValue(Promise.resolve({ data: null, error: null }));
});

describe('fareBucket', () => {
  it('classe les montants invalides en "unknown"', () => {
    expect(fareBucket(0)).toBe('unknown');
    expect(fareBucket(-5)).toBe('unknown');
    expect(fareBucket(NaN)).toBe('unknown');
    expect(fareBucket(Infinity)).toBe('unknown');
  });

  it('classe chaque tranche, bornes incluses', () => {
    expect(fareBucket(5)).toBe('5-10');
    expect(fareBucket(9.99)).toBe('5-10');
    expect(fareBucket(10)).toBe('10-20');
    expect(fareBucket(19.99)).toBe('10-20');
    expect(fareBucket(20)).toBe('20-30');
    expect(fareBucket(29.99)).toBe('20-30');
    expect(fareBucket(30)).toBe('30-50');
    expect(fareBucket(49.99)).toBe('30-50');
    expect(fareBucket(50)).toBe('50+');
    expect(fareBucket(200)).toBe('50+');
  });

  it('ne renvoie jamais de montant exact (anti-PII)', () => {
    const known = new Set(['unknown', '5-10', '10-20', '20-30', '30-50', '50+']);
    for (const f of [3, 7.42, 14.7, 23.9, 38.5, 99.99]) {
      expect(known.has(fareBucket(f))).toBe(true);
    }
  });
});

describe('logScanEvent', () => {
  it('mappe les champs vers les params du RPC', () => {
    logScanEvent({
      platform: 'UBER',
      addressesFound: 2,
      geminiFallback: false,
      durationSource: 'reported',
      verdict: 2,
      fareBucket: '10-20',
    });
    expect(mockRpc).toHaveBeenCalledWith('log_scan_event', {
      p_platform: 'UBER',
      p_addresses_found: 2,
      p_gemini_fallback: false,
      p_duration_source: 'reported',
      p_verdict: 2,
      p_fare_bucket: '10-20',
    });
  });

  it('ne lève jamais si le RPC rejette (fire-and-forget)', async () => {
    mockRpc.mockReturnValue(Promise.reject(new Error('db down')));
    expect(() =>
      logScanEvent({
        platform: 'BOLT',
        addressesFound: 0,
        geminiFallback: true,
        durationSource: 'estimated',
        verdict: 0,
        fareBucket: 'unknown',
      }),
    ).not.toThrow();
    await Promise.resolve(); // flush la microtask de rejet
  });

  it('ne lève jamais si le RPC throw de façon synchrone', () => {
    mockRpc.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() =>
      logScanEvent({
        platform: 'HEETCH',
        addressesFound: 1,
        geminiFallback: false,
        durationSource: 'reported',
        verdict: 1,
        fareBucket: '5-10',
      }),
    ).not.toThrow();
  });
});
