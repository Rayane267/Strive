// Mock supabase to avoid import chain issues in test
const mockSingle: jest.Mock = jest.fn();
const mockOrder: jest.Mock = jest.fn(() => ({ data: [], error: null }));
const mockGte: jest.Mock = jest.fn(() => ({ order: mockOrder }));
const mockEq: jest.Mock = jest.fn(() => ({ gte: mockGte, data: null, error: null }));
// `maybeSingle` : createRide ne peut pas utiliser `single`, un conflit d'id
// renvoyant zéro ligne (`on conflict do nothing`, cf. ridesService).
const mockSelect: jest.Mock = jest.fn(() => ({ eq: mockEq, single: mockSingle, maybeSingle: mockSingle }));
const mockUpsert: jest.Mock = jest.fn(() => ({ select: mockSelect }));
const mockUpdate: jest.Mock = jest.fn(() => ({ eq: mockEq }));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: mockSelect,
      upsert: mockUpsert,
      update: mockUpdate,
      eq: mockEq,
      gte: mockGte,
      order: mockOrder,
      single: mockSingle,
      maybeSingle: mockSingle,
    })),
  },
}));

import {
  effectiveFare,
  fetchRides,
  createRide,
  updateRideStatus,
  updateRideFare,
} from '../ridesService';
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

  it('prefers fare_final even when it is lower than the estimate', () => {
    expect(effectiveFare({ fare_estimated: 20, fare_final: 12 })).toBe(12);
  });
});

describe('fetchRides', () => {
  it('calls supabase with correct params', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    const since = new Date('2026-04-01');
    await fetchRides('user-123', since);
    expect(supabase.from).toHaveBeenCalledWith('rides');
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-123');
    expect(mockGte).toHaveBeenCalledWith('created_at', since.toISOString());
  });

  it('returns the rows returned by supabase', async () => {
    const rows = [{ id: 'r1' }, { id: 'r2' }];
    mockOrder.mockResolvedValueOnce({ data: rows, error: null });
    await expect(fetchRides('user-123', new Date())).resolves.toEqual(rows);
  });

  it('returns an empty array when data is null', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchRides('user-123', new Date())).resolves.toEqual([]);
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

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'UBER' }),
      { onConflict: 'id', ignoreDuplicates: true },
    );
  });

  it('keeps a known platform unchanged and defaults status to PENDING', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: '2', platform: 'BOLT' }, error: null });

    await createRide({
      userId: 'u1',
      platform: 'BOLT',
      fare: 12,
      distanceKm: 4,
      durationMin: 8,
      hourlyRate: 60,
      kmRate: 2,
      pickupAddress: '1 rue A',
      destinationAddress: '2 rue B',
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'BOLT',
        status: 'PENDING',
        fare_estimated: 12,
        pickup_address: '1 rue A',
        destination_address: '2 rue B',
      }),
      { onConflict: 'id', ignoreDuplicates: true },
    );
  });

  it('coalesces missing addresses to null', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: '3' }, error: null });

    await createRide({
      userId: 'u1',
      platform: 'HEETCH',
      fare: 9,
      distanceKm: 3,
      durationMin: 6,
      hourlyRate: 50,
      kmRate: 2,
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ pickup_address: null, destination_address: null }),
      { onConflict: 'id', ignoreDuplicates: true },
    );
  });

  it('throws when supabase rejects the insert', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'insert failed' } });
    await expect(
      createRide({
        userId: 'u1',
        platform: 'UBER',
        fare: 10,
        distanceKm: 5,
        durationMin: 10,
        hourlyRate: 60,
        kmRate: 2,
      }),
    ).rejects.toBeDefined();
  });
});

describe('updateRideStatus', () => {
  it('updates the status filtered by id', async () => {
    mockEq.mockReturnValueOnce({
      select: jest.fn().mockResolvedValue({ data: [{ id: 'ride-1' }], error: null }),
    } as any);
    await updateRideStatus('ride-1', 'ACCEPTED');
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'ACCEPTED' });
    expect(mockEq).toHaveBeenCalledWith('id', 'ride-1');
  });

  it('throws on supabase error', async () => {
    mockEq.mockReturnValueOnce({
      select: jest.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
    } as any);
    await expect(updateRideStatus('ride-1', 'DECLINED')).rejects.toBeDefined();
  });

  // Le cas qui a motivé le `.select()` : la RLS écarte la ligne, la session a
  // expiré, ou l'id ne correspond à rien. Supabase ne rend AUCUNE erreur — juste
  // zéro ligne. Sans ce test, la régression reviendrait sans être vue.
  it('throws when no row was updated', async () => {
    mockEq.mockReturnValueOnce({
      select: jest.fn().mockResolvedValue({ data: [], error: null }),
    } as any);
    await expect(updateRideStatus('ride-1', 'ACCEPTED')).rejects.toBeDefined();
  });
});

describe('updateRideFare', () => {
  it('writes fare_final filtered by id', async () => {
    mockEq.mockReturnValueOnce({ error: null } as any);
    await updateRideFare('ride-1', 23.5);
    expect(mockUpdate).toHaveBeenCalledWith({ fare_final: 23.5 });
    expect(mockEq).toHaveBeenCalledWith('id', 'ride-1');
  });

  it('throws on supabase error', async () => {
    mockEq.mockReturnValueOnce({ error: { message: 'fail' } } as any);
    await expect(updateRideFare('ride-1', 10)).rejects.toBeDefined();
  });
});
