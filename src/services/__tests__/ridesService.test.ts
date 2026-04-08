// Mock supabase to avoid import chain issues in test
const mockSingle = jest.fn();
const mockOrder = jest.fn(() => ({ data: [], error: null }));
const mockGte = jest.fn(() => ({ order: mockOrder }));
const mockEq = jest.fn(() => ({ gte: mockGte, data: null, error: null }));
const mockSelect = jest.fn(() => ({ eq: mockEq, single: mockSingle }));
const mockInsert = jest.fn(() => ({ select: mockSelect }));
const mockUpdate = jest.fn(() => ({ eq: mockEq }));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      eq: mockEq,
      gte: mockGte,
      order: mockOrder,
      single: mockSingle,
    })),
  },
}));

import { effectiveFare, fetchRides, createRide, updateRideStatus } from '../ridesService';
import { supabase } from '../supabase';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('effectiveFare', () => {
  it('returns fare_final when available', () => {
    expect(effectiveFare({ fare_estimated: 15.0, fare_final: 18.5 })).toBe(18.5);
  });

  it('returns fare_estimated when fare_final is null', () => {
    expect(effectiveFare({ fare_estimated: 15.0, fare_final: null })).toBe(15.0);
  });

  it('handles zero fares', () => {
    expect(effectiveFare({ fare_estimated: 0, fare_final: null })).toBe(0);
    expect(effectiveFare({ fare_estimated: 10, fare_final: 0 })).toBe(0);
  });
});

describe('fetchRides', () => {
  it('calls supabase with correct params', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    const since = new Date('2026-04-01');
    await fetchRides('user-123', since);
    expect(supabase.from).toHaveBeenCalledWith('rides');
  });

  it('throws on supabase error', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'fail' } });
    await expect(fetchRides('user-123', new Date())).rejects.toBeDefined();
  });
});

describe('createRide', () => {
  it('maps UNKNOWN platform to UBER', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: '1', platform: 'UBER' },
      error: null,
    });

    await createRide({
      userId: 'u1',
      platform: 'UNKNOWN',
      fare: 10,
      distanceKm: 5,
      durationMin: 10,
      hourlyRate: 60,
      kmRate: 2,
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'UBER' }),
    );
  });
});
