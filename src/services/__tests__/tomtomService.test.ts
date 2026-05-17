jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Mock env — must be before import
jest.mock('@env', () => ({ TOMTOM_API_KEY: 'test-key' }), { virtual: true });

import { calculateRouteDuration } from '../tomtomService';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('calculateRouteDuration', () => {
  const geocodeResponse = (lat: number, lon: number) => ({
    ok: true,
    json: () => Promise.resolve({ results: [{ position: { lat, lon } }] }),
  });

  const routeResponse = (seconds: number) => ({
    ok: true,
    json: () =>
      Promise.resolve({ routes: [{ summary: { travelTimeInSeconds: seconds, lengthInMeters: 5000 } }] }),
  });

  it('returns duration in minutes for valid addresses', async () => {
    mockFetch
      .mockResolvedValueOnce(geocodeResponse(48.85, 2.35))   // pickup
      .mockResolvedValueOnce(geocodeResponse(48.87, 2.33))   // destination
      .mockResolvedValueOnce(routeResponse(900));             // 15 min

    const result = await calculateRouteDuration('Paris', 'Montmartre');
    expect(result).toBe(15);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns null when geocode fails for pickup', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(geocodeResponse(48.87, 2.33));

    const result = await calculateRouteDuration('???', 'Montmartre');
    expect(result).toBeNull();
  });

  it('returns null when geocode returns no results', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })
      .mockResolvedValueOnce(geocodeResponse(48.87, 2.33));

    const result = await calculateRouteDuration('nowhere', 'Montmartre');
    expect(result).toBeNull();
  });

  it('returns null when routing API fails', async () => {
    mockFetch
      .mockResolvedValueOnce(geocodeResponse(48.85, 2.35))
      .mockResolvedValueOnce(geocodeResponse(48.87, 2.33))
      .mockResolvedValueOnce({ ok: false });

    const result = await calculateRouteDuration('Paris', 'Montmartre');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const result = await calculateRouteDuration('Paris', 'Montmartre');
    expect(result).toBeNull();
  });

  it('rounds duration to nearest minute', async () => {
    mockFetch
      .mockResolvedValueOnce(geocodeResponse(48.85, 2.35))
      .mockResolvedValueOnce(geocodeResponse(48.87, 2.33))
      .mockResolvedValueOnce(routeResponse(450)); // 7.5 min → 8

    const result = await calculateRouteDuration('A', 'B');
    expect(result).toBe(8);
  });
});
