jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

const asyncStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k: string) => Promise.resolve(asyncStore[k] ?? null)),
  setItem: jest.fn((k: string, v: string) => {
    asyncStore[k] = v;
    return Promise.resolve();
  }),
  removeItem: jest.fn((k: string) => {
    delete asyncStore[k];
    return Promise.resolve();
  }),
}));

import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from '../secureStorage';

const mockKeychain = Keychain as jest.Mocked<typeof Keychain>;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(asyncStore)) delete asyncStore[k];
});

describe('secureStorage.getItem', () => {
  it('returns the password stored in the Keychain', async () => {
    mockKeychain.getGenericPassword.mockResolvedValue({
      service: 'session',
      username: 'session',
      password: 'token-123',
      storage: 'keychain',
    } as any);

    await expect(secureStorage.getItem('session')).resolves.toBe('token-123');
    expect(mockKeychain.getGenericPassword).toHaveBeenCalledWith({ service: 'session' });
  });

  it('returns null when neither Keychain nor legacy storage hold the key', async () => {
    mockKeychain.getGenericPassword.mockResolvedValue(false as any);
    await expect(secureStorage.getItem('missing')).resolves.toBeNull();
  });

  it('migrates a legacy AsyncStorage value into the Keychain then purges it', async () => {
    mockKeychain.getGenericPassword.mockResolvedValue(false as any);
    asyncStore['session'] = 'legacy-token';

    const result = await secureStorage.getItem('session');

    expect(result).toBe('legacy-token');
    expect(mockKeychain.setGenericPassword).toHaveBeenCalledWith(
      'session',
      'legacy-token',
      expect.objectContaining({ service: 'session' }),
    );
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('session');
  });

  it('falls back to AsyncStorage when the Keychain throws', async () => {
    mockKeychain.getGenericPassword.mockRejectedValue(new Error('keychain down'));
    asyncStore['session'] = 'fallback-token';
    await expect(secureStorage.getItem('session')).resolves.toBe('fallback-token');
  });
});

describe('secureStorage.setItem', () => {
  it('writes to the Keychain with the AFTER_FIRST_UNLOCK accessibility', async () => {
    mockKeychain.setGenericPassword.mockResolvedValue(true as any);
    await secureStorage.setItem('session', 'val');
    expect(mockKeychain.setGenericPassword).toHaveBeenCalledWith(
      'session',
      'val',
      expect.objectContaining({ service: 'session', accessible: 'AfterFirstUnlock' }),
    );
  });

  it('falls back to AsyncStorage when the Keychain write fails', async () => {
    mockKeychain.setGenericPassword.mockRejectedValue(new Error('fail'));
    await secureStorage.setItem('session', 'val');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('session', 'val');
  });
});

describe('secureStorage.removeItem', () => {
  it('clears both the Keychain and AsyncStorage', async () => {
    mockKeychain.resetGenericPassword.mockResolvedValue(true as any);
    await secureStorage.removeItem('session');
    expect(mockKeychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'session' });
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('session');
  });

  it('still clears AsyncStorage even if the Keychain reset throws', async () => {
    mockKeychain.resetGenericPassword.mockRejectedValue(new Error('fail'));
    await secureStorage.removeItem('session');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('session');
  });
});
