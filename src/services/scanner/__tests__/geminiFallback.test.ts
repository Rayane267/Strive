// NOTE: babel-plugin-react-native-dotenv inline les valeurs `@env` au moment du
// transform à partir du fichier `.env` — un jest.mock('@env') serait inopérant.
// Les tests lisent donc la vraie clé via l'import et la CI fournit un `.env` non
// vide (cf. .github/workflows/ci.yml). On skip proprement si l'env est absent.
import { PUBLIC_SUPABASE_KEY, PUBLIC_SUPABASE_URL } from '@env';

const mockGetSession = jest.fn();
jest.mock('../../supabase', () => ({
  supabase: { auth: { getSession: () => mockGetSession() } },
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;
(global as any).__DEV__ = false;

import { extractWithGemini } from '../geminiFallback';

const envReady = Boolean(PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_KEY);
const describeWithEnv = envReady ? describe : describe.skip;

/** Wraps a model JSON payload in the Gemini candidates envelope. */
const geminiResponse = (payload: unknown, raw?: string) => ({
  ok: true,
  json: () =>
    Promise.resolve({
      candidates: [
        { content: { parts: [{ text: raw ?? JSON.stringify(payload) }] } },
      ],
    }),
});

const validRide = {
  platform: 'UBER',
  fare: 17.18,
  distanceKm: 11.8,
  durationMin: 20,
  pickupAddress: '65 Route de la Libération',
  destinationAddress: '16 Rue Charles Pathé',
  pickupDurationMin: 6,
  pickupDistanceKm: 1.2,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } });
});

describeWithEnv('extractWithGemini', () => {
  it('returns null immediately when no image is provided', async () => {
    await expect(extractWithGemini('')).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('parses a valid ride and forwards the user JWT', async () => {
    mockFetch.mockResolvedValue(geminiResponse(validRide));

    const result = await extractWithGemini('base64data');

    expect(result).toMatchObject({
      platform: 'UBER',
      fare: 17.18,
      distanceKm: 11.8,
      durationMin: 20,
      pickupDistanceKm: 1.2,
      pickupDurationMin: 6,
    });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer jwt-123');
  });

  it('falls back to the anon key when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockFetch.mockResolvedValue(geminiResponse(validRide));

    await extractWithGemini('base64data');
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Bearer ${PUBLIC_SUPABASE_KEY}`);
  });

  it('strips ```json markdown fences before parsing', async () => {
    const fenced = '```json\n' + JSON.stringify(validRide) + '\n```';
    mockFetch.mockResolvedValue(geminiResponse(null, fenced));
    const result = await extractWithGemini('base64data');
    expect(result?.fare).toBe(17.18);
  });

  it('returns null when the model reports not_a_ride', async () => {
    mockFetch.mockResolvedValue(geminiResponse({ error: 'not_a_ride' }));
    await expect(extractWithGemini('base64data')).resolves.toBeNull();
  });

  it('returns null on a non-OK HTTP response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(extractWithGemini('base64data')).resolves.toBeNull();
  });

  it('returns null when the response body is not valid JSON', async () => {
    mockFetch.mockResolvedValue(geminiResponse(null, 'this is not json'));
    await expect(extractWithGemini('base64data')).resolves.toBeNull();
  });

  it.each([
    ['fare below min', { ...validRide, fare: 2 }],
    ['fare above max', { ...validRide, fare: 250 }],
    ['distance below min', { ...validRide, distanceKm: 0.1 }],
    ['distance above max', { ...validRide, distanceKm: 2000 }],
  ])('rejects %s', async (_label, payload) => {
    mockFetch.mockResolvedValue(geminiResponse(payload));
    await expect(extractWithGemini('base64data')).resolves.toBeNull();
  });

  it('rejects an implausible fare/distance ratio (hallucinated tiny distance)', async () => {
    // 50€ / 0.5km = 100 €/km — well above the 15 ceiling
    mockFetch.mockResolvedValue(geminiResponse({ ...validRide, fare: 50, distanceKm: 0.5 }));
    await expect(extractWithGemini('base64data')).resolves.toBeNull();
  });

  it('maps an unknown platform string to UNKNOWN', async () => {
    mockFetch.mockResolvedValue(geminiResponse({ ...validRide, platform: 'FREENOW' }));
    const result = await extractWithGemini('base64data');
    expect(result?.platform).toBe('UNKNOWN');
  });

  it('nulls durationMin when the model omits it', async () => {
    const withoutDuration: Record<string, unknown> = { ...validRide };
    delete withoutDuration.durationMin;
    mockFetch.mockResolvedValue(geminiResponse(withoutDuration));
    const result = await extractWithGemini('base64data');
    expect(result?.durationMin).toBeNull();
  });

  it('drops an out-of-range pickup duration (> 60 min)', async () => {
    mockFetch.mockResolvedValue(geminiResponse({ ...validRide, pickupDurationMin: 90 }));
    const result = await extractWithGemini('base64data');
    expect(result?.pickupDurationMin).toBeUndefined();
  });
});
