jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
}));

const mockSingle = jest.fn();
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          // `maybeSingle` et non `single` : c'est lui qui distingue « aucune
          // ligne » (résultat légitime) d'un vrai échec de requête.
          maybeSingle: mockSingle,
        })),
      })),
    })),
  },
}));

import { fetchProfile, fetchProfileResult } from '../profileService';
import * as Sentry from '@sentry/react-native';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchProfile', () => {
  it('returns profile data on success', async () => {
    const mockProfile = {
      id: 'user-1',
      subscription_tier: 'free',
      extra_scan_credits: 0,
      min_hourly_rate: 25,
      min_km_rate: 1.2,
    };
    mockSingle.mockResolvedValueOnce({ data: mockProfile, error: null });

    const result = await fetchProfile('user-1');
    expect(result).toEqual(mockProfile);
  });

  it('returns null and logs to Sentry on error', async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'not found' },
    });

    const result = await fetchProfile('user-999');
    expect(result).toBeNull();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'profile',
        level: 'error',
      }),
    );
  });
});

// Ces trois cas sont ceux que `single()` rendait indiscernables, et cette
// confusion enfermait un compte supprimé sur un écran d'erreur sans issue.
describe('fetchProfileResult', () => {
  it('distingue un vrai échec de requête', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    expect(await fetchProfileResult('u')).toEqual({ error: 'network down' });
  });

  it('signale une absence de ligne SANS la traiter comme une erreur', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchProfileResult('u')).toEqual({ missing: true });
  });

  it('rend le profil quand il existe', async () => {
    const p = { id: 'u', subscription_tier: 'free' };
    mockSingle.mockResolvedValueOnce({ data: p, error: null });
    expect(await fetchProfileResult('u')).toEqual({ profile: p });
  });
});
