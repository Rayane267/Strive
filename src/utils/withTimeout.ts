/**
 * Helpers pour ajouter un timeout + retry à une Promise (typiquement calls
 * Supabase, fetch) sans dépendance externe.
 *
 * Utilisation :
 *   const data = await withRetry(() => supabase.from('rides').select('*'), 2);
 *   const result = await withTimeout(fetch(url), 10_000);
 */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Rejette si la promise ne résout pas avant `ms` millisecondes. */
export function withTimeout<T>(promise: Promise<T>, ms = 10_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new TimeoutError(ms)), ms)),
  ]);
}

/**
 * Retry avec backoff exponentiel + timeout par tentative. Skip le retry si
 * l'erreur est "connue non-transiente" (auth, validation).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 1,
  timeoutMs = 10_000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (e: any) {
      lastError = e;
      // Skip retry sur erreurs non-transientes (auth, schéma, quota)
      const code = e?.code ?? e?.status;
      if (code === 401 || code === 403 || code === 422) throw e;
      if (attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s...
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
