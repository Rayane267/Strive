const asyncStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k: string) => Promise.resolve(asyncStore[k] ?? null)),
  setItem: jest.fn((k: string, v: string) => {
    asyncStore[k] = v;
    return Promise.resolve();
  }),
}));

const mockCanOpenURL = jest.fn();
const mockOpenURL = jest.fn();
jest.mock('react-native', () => ({
  Platform: { select: (opts: any) => opts.android },
  Linking: {
    canOpenURL: (...args: any[]) => mockCanOpenURL(...args),
    openURL: (...args: any[]) => mockOpenURL(...args),
  },
}));

import {
  maybePromptRating,
  markRatingPrompted,
  openStoreForRating,
} from '../ratingPrompt';

const STORAGE_KEY = '@strive_rating_prompted';

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(asyncStore)) delete asyncStore[k];
});

describe('maybePromptRating', () => {
  it('returns false below the trigger threshold (5 accepted rides)', async () => {
    await expect(maybePromptRating(4)).resolves.toBe(false);
  });

  it('returns true at the threshold when never prompted before', async () => {
    await expect(maybePromptRating(5)).resolves.toBe(true);
  });

  it('returns false once the user has already been prompted', async () => {
    asyncStore[STORAGE_KEY] = '1';
    await expect(maybePromptRating(10)).resolves.toBe(false);
  });
});

describe('markRatingPrompted', () => {
  it('persists the prompted flag', async () => {
    await markRatingPrompted();
    expect(asyncStore[STORAGE_KEY]).toBe('1');
  });
});

describe('openStoreForRating', () => {
  it('opens the store URL without asking canOpenURL first', async () => {
    mockOpenURL.mockResolvedValue(undefined);
    await openStoreForRating();
    expect(mockCanOpenURL).not.toHaveBeenCalled();
    expect(mockOpenURL).toHaveBeenCalledWith('market://details?id=com.striveapp.app');
  });

  it('falls back to the web listing when no store app opens the link', async () => {
    mockOpenURL.mockRejectedValueOnce(new Error('no activity')).mockResolvedValue(undefined);
    await openStoreForRating();
    expect(mockOpenURL).toHaveBeenLastCalledWith(
      'https://play.google.com/store/apps/details?id=com.striveapp.app',
    );
  });
});
