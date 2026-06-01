jest.mock('@sentry/react-native', () => ({ addBreadcrumb: jest.fn() }));

const asyncStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k: string) => Promise.resolve(asyncStore[k] ?? null)),
  setItem: jest.fn((k: string, v: string) => {
    asyncStore[k] = v;
    return Promise.resolve();
  }),
}));

const mockSingle = jest.fn();
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        limit: jest.fn(() => ({ single: mockSingle })),
      })),
    })),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchParserConfig } from '../parserConfigService';

const CACHE_KEY = '@strive_parser_config';

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(asyncStore)) delete asyncStore[k];
});

describe('fetchParserConfig', () => {
  it('returns the cached config without hitting Supabase when fresh', async () => {
    asyncStore[CACHE_KEY] = JSON.stringify({
      configJson: '{"v":1}',
      timestamp: Date.now(),
    });

    const result = await fetchParserConfig();
    expect(result).toBe('{"v":1}');
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it('ignores an expired cache entry and refetches from Supabase', async () => {
    asyncStore[CACHE_KEY] = JSON.stringify({
      configJson: '{"stale":true}',
      timestamp: Date.now() - 25 * 60 * 60 * 1000, // > 24h
    });
    mockSingle.mockResolvedValue({ data: { config: { fresh: true } }, error: null });

    const result = await fetchParserConfig();
    expect(result).toBe(JSON.stringify({ fresh: true }));
    expect(mockSingle).toHaveBeenCalled();
  });

  it('caches the freshly fetched config', async () => {
    mockSingle.mockResolvedValue({ data: { config: { a: 1 } }, error: null });

    await fetchParserConfig();

    const cached = JSON.parse(asyncStore[CACHE_KEY]);
    expect(cached.configJson).toBe(JSON.stringify({ a: 1 }));
    expect(typeof cached.timestamp).toBe('number');
  });

  it('returns null on a Supabase error', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'no table' } });
    await expect(fetchParserConfig()).resolves.toBeNull();
  });

  it('returns null when AsyncStorage throws (resilient)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk error'));
    await expect(fetchParserConfig()).resolves.toBeNull();
  });
});
