import { withTimeout, withRetry, TimeoutError } from '../withTimeout';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves with the value when the promise settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000);
    expect(result).toBe('ok');
  });

  it('rejects with TimeoutError when the promise is too slow', async () => {
    const never = new Promise<string>(() => {});
    const raced = withTimeout(never, 5000);
    jest.advanceTimersByTime(5000);
    await expect(raced).rejects.toBeInstanceOf(TimeoutError);
  });

  it('propagates the original rejection (not a timeout) when the promise rejects first', async () => {
    const boom = Promise.reject(new Error('boom'));
    await expect(withTimeout(boom, 5000)).rejects.toThrow('boom');
  });

  it('encodes the timeout duration in the error message', () => {
    expect(new TimeoutError(1234).message).toContain('1234ms');
  });
});

describe('withRetry', () => {
  it('returns immediately when the first attempt succeeds (no retry)', async () => {
    const fn = jest.fn().mockResolvedValue('value');
    await expect(withRetry(fn, 2)).resolves.toBe('value');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient failure then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce('recovered');

    const promise = withRetry(fn, 2, 10_000);
    // backoff de 500ms entre attempt 0 et 1
    await jest.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting all retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('persistent'));
    const promise = withRetry(fn, 2, 10_000);
    // Attache le handler de rejet AVANT d'avancer les timers pour éviter
    // une unhandled rejection pendant le flush des backoffs (500ms + 1000ms).
    const assertion = expect(promise).rejects.toThrow('persistent');
    await jest.advanceTimersByTimeAsync(1500);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3); // attempt 0 + 2 retries
  });

  it.each([401, 403, 422])(
    'does not retry on non-transient status %i',
    async (status) => {
      const fn = jest.fn().mockRejectedValue({ status });
      await expect(withRetry(fn, 3)).rejects.toMatchObject({ status });
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  it('reads the error code from either `code` or `status`', async () => {
    const fn = jest.fn().mockRejectedValue({ code: 403 });
    await expect(withRetry(fn, 3)).rejects.toMatchObject({ code: 403 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
