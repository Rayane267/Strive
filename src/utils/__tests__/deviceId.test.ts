jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

const mockRpc = jest.fn();
jest.mock('../../services/supabase', () => ({
  supabase: { rpc: (...args: any[]) => mockRpc(...args) },
}));

import * as Keychain from 'react-native-keychain';
import {
  getOrCreateDeviceId,
  enforceSignupQuota,
  enforceOAuthSignupQuota,
  registerOAuthSignup,
} from '../deviceId';

const mockKeychain = Keychain as jest.Mocked<typeof Keychain>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getOrCreateDeviceId', () => {
  it('returns the existing device id from the Keychain', async () => {
    mockKeychain.getGenericPassword.mockResolvedValue({
      password: 'existing-device-id-1234',
    } as any);

    await expect(getOrCreateDeviceId()).resolves.toBe('existing-device-id-1234');
    expect(mockKeychain.setGenericPassword).not.toHaveBeenCalled();
  });

  it('generates and persists a valid UUID v4 when none exists', async () => {
    mockKeychain.getGenericPassword.mockResolvedValue(false as any);
    mockKeychain.setGenericPassword.mockResolvedValue(true as any);

    const id = await getOrCreateDeviceId();
    expect(id).toMatch(UUID_RE);
    expect(mockKeychain.setGenericPassword).toHaveBeenCalledWith(
      'deviceId',
      id,
      expect.objectContaining({ service: 'com.striveapp.deviceId' }),
    );
  });

  it('regenerates when the stored value is too short to be trusted', async () => {
    mockKeychain.getGenericPassword.mockResolvedValue({ password: 'short' } as any);
    mockKeychain.setGenericPassword.mockResolvedValue(true as any);

    const id = await getOrCreateDeviceId();
    expect(id).toMatch(UUID_RE);
    expect(mockKeychain.setGenericPassword).toHaveBeenCalled();
  });

  it('falls back to an ephemeral UUID if the Keychain throws', async () => {
    mockKeychain.getGenericPassword.mockRejectedValue(new Error('no keychain'));
    await expect(getOrCreateDeviceId()).resolves.toMatch(UUID_RE);
  });
});

describe('enforceSignupQuota', () => {
  beforeEach(() => {
    mockKeychain.getGenericPassword.mockResolvedValue({
      password: 'existing-device-id-1234',
    } as any);
  });

  it('resolves silently when the RPC succeeds', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await expect(enforceSignupQuota()).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('check_and_register_device_signup', {
      p_device_id: 'existing-device-id-1234',
    });
  });

  it('throws a limit-reached error when the device hit the cap', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'device_signup_limit_reached' } });
    await expect(enforceSignupQuota()).rejects.toThrow('device_signup_limit_reached');
  });

  it('throws a generic check error for unexpected RPC failures', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'network blip' } });
    await expect(enforceSignupQuota()).rejects.toThrow('signup_quota_check_failed');
  });
});

describe('OAuth signup quota', () => {
  it('allows signup when fewer than 3 recent signups are recorded', async () => {
    mockKeychain.getGenericPassword.mockResolvedValue({
      password: JSON.stringify([Date.now(), Date.now()]),
    } as any);
    await expect(enforceOAuthSignupQuota()).resolves.toBeUndefined();
  });

  it('blocks signup at 3 recent signups within the 60-day window', async () => {
    const now = Date.now();
    mockKeychain.getGenericPassword.mockResolvedValue({
      password: JSON.stringify([now, now, now]),
    } as any);
    await expect(enforceOAuthSignupQuota()).rejects.toThrow('device_signup_limit_reached');
  });

  it('ignores signups older than 60 days', async () => {
    const old = Date.now() - 61 * 24 * 60 * 60 * 1000;
    mockKeychain.getGenericPassword.mockResolvedValue({
      password: JSON.stringify([old, old, old]),
    } as any);
    await expect(enforceOAuthSignupQuota()).resolves.toBeUndefined();
  });

  it('treats an empty/corrupt Keychain entry as zero signups', async () => {
    mockKeychain.getGenericPassword.mockResolvedValue(false as any);
    await expect(enforceOAuthSignupQuota()).resolves.toBeUndefined();
  });

  it('registerOAuthSignup appends a timestamp and prunes the old ones', async () => {
    const old = Date.now() - 61 * 24 * 60 * 60 * 1000;
    mockKeychain.getGenericPassword.mockResolvedValue({
      password: JSON.stringify([old]),
    } as any);
    mockKeychain.setGenericPassword.mockResolvedValue(true as any);

    await registerOAuthSignup();

    const persisted = JSON.parse(
      (mockKeychain.setGenericPassword.mock.calls[0][1]) as string,
    );
    expect(persisted).toHaveLength(1); // old pruned, one fresh added
    expect(persisted[0]).toBeGreaterThan(old);
  });
});
