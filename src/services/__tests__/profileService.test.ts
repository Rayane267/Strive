jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
}));

const mockSingle = jest.fn();
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: mockSingle,
        })),
      })),
    })),
  },
}));

import { fetchProfile } from '../profileService';
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
