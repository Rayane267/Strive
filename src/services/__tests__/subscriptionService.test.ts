import { getPlanTier, getPlanLimits, getRemainingScans } from '../subscriptionService';

describe('getPlanTier', () => {
  it('returns free by default', () => {
    expect(getPlanTier()).toBe('free');
    expect(getPlanTier(null)).toBe('free');
    expect(getPlanTier(undefined)).toBe('free');
    expect(getPlanTier('unknown')).toBe('free');
  });

  it('returns plus for plus tier', () => {
    expect(getPlanTier('plus')).toBe('plus');
  });

  it('returns premium for premium/pro tier', () => {
    expect(getPlanTier('premium')).toBe('premium');
    expect(getPlanTier('pro')).toBe('premium');
  });
});

describe('getPlanLimits', () => {
  it('returns correct limits for free tier', () => {
    const limits = getPlanLimits('free');
    expect(limits.dailyScans).toBe(3);
    expect(limits.analyticsRangeDays).toBe(1);
  });

  it('returns correct limits for plus tier', () => {
    const limits = getPlanLimits('plus');
    expect(limits.dailyScans).toBe(30);
    expect(limits.analyticsRangeDays).toBe(7);
  });

  it('returns unlimited for premium tier', () => {
    const limits = getPlanLimits('premium');
    expect(limits.dailyScans).toBeNull();
    expect(limits.analyticsRangeDays).toBeNull();
  });
});

describe('getRemainingScans', () => {
  it('returns null for premium (unlimited)', () => {
    expect(getRemainingScans('premium', 100, 0)).toBeNull();
  });

  it('returns remaining from daily quota for free tier', () => {
    expect(getRemainingScans('free', 0, 0)).toBe(3);
    expect(getRemainingScans('free', 2, 0)).toBe(1);
    expect(getRemainingScans('free', 3, 0)).toBe(0);
  });

  it('adds extra credits after daily quota exhausted', () => {
    expect(getRemainingScans('free', 3, 5)).toBe(5);
    expect(getRemainingScans('free', 0, 3)).toBe(6); // 3 from plan + 3 extra
  });

  it('returns remaining for plus tier', () => {
    expect(getRemainingScans('plus', 10, 0)).toBe(20); // 30 daily - 10 used
    expect(getRemainingScans('plus', 30, 0)).toBe(0);
    expect(getRemainingScans('plus', 30, 5)).toBe(5); // quota exhausted + 5 extra
  });

  it('counts welcome credits alongside purchased ones', () => {
    // Ordre serveur : quota, puis cadeau, puis achats — mais le total restant
    // est le même quel que soit l'ordre de consommation.
    expect(getRemainingScans('free', 3, 0, 30)).toBe(30);
    expect(getRemainingScans('free', 0, 2, 30)).toBe(35); // 3 plan + 30 cadeau + 2 achetés
    expect(getRemainingScans('free', 3, 0, 0)).toBe(0);   // cadeau périmé → rien
    expect(getRemainingScans('premium', 100, 0, 30)).toBeNull();
  });

  it('clamps negative or NaN counters to zero', () => {
    expect(getRemainingScans('free', -5, 0)).toBe(3);
    expect(getRemainingScans('free', NaN, NaN)).toBe(3);
    expect(getRemainingScans('free', 0, -10)).toBe(3);
  });

  it('never returns negative from plan', () => {
    expect(getRemainingScans('free', 100, 0)).toBe(0);
  });
});
