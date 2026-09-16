jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { shouldAlertLowCredits, scheduleSessionReminder } from '../notificationService';
import { toLocalDateKey } from '../../utils/dateUtils';

describe('shouldAlertLowCredits', () => {
  it('returns false for unlimited (null)', () => {
    expect(shouldAlertLowCredits(null, 'free')).toBe(false);
  });

  it('returns false for premium users', () => {
    expect(shouldAlertLowCredits(1, 'premium')).toBe(false);
  });

  it('returns true when remaining is 1 for free user', () => {
    expect(shouldAlertLowCredits(1, 'free')).toBe(true);
  });

  it('returns true when remaining is 0 for free user', () => {
    expect(shouldAlertLowCredits(0, 'free')).toBe(true);
  });

  it('returns false when remaining is above 1', () => {
    expect(shouldAlertLowCredits(5, 'free')).toBe(false);
  });

  it('returns false for negative remaining', () => {
    expect(shouldAlertLowCredits(-1, 'free')).toBe(false);
  });
});

describe('scheduleSessionReminder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets reminder key for today', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await scheduleSessionReminder();
    const today = toLocalDateKey(new Date());
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@strive_last_reminder',
      today,
    );
  });

  it('skips if already reminded today', async () => {
    const today = toLocalDateKey(new Date());
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(today);
    await scheduleSessionReminder();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
