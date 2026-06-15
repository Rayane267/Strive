import { formatDuration, getDayStart, formatTimeAgo } from '../dateUtils';

describe('formatDuration', () => {
  it('formats zero as "0m 00s"', () => {
    expect(formatDuration(0)).toBe('0m 00s');
  });

  it('formats sub-minute durations under the minute bucket with zero-padded seconds', () => {
    expect(formatDuration(30)).toBe('0m 30s');
    expect(formatDuration(59)).toBe('0m 59s');
  });

  it('formats minutes and seconds with zero-padded seconds', () => {
    expect(formatDuration(60)).toBe('1m 00s');
    expect(formatDuration(125)).toBe('2m 05s');
  });

  it('formats whole hours without the minutes segment', () => {
    expect(formatDuration(3600)).toBe('1h');
  });

  it('formats hours with zero-padded minutes when present', () => {
    expect(formatDuration(5465)).toBe('1h 31min'); // 1h31m05s → seconds dropped at hour scale
  });
});

describe('getDayStart', () => {
  // Fake timers → toutes les branches sont couvertes de façon déterministe
  // (les anciens tests étaient skippés selon l'heure réelle d'exécution).
  afterEach(() => jest.useRealTimers());

  it('resetHour=0 → minuit du jour courant', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 7, 10, 30, 0)); // 7 juin 2026 10:30 local
    const result = getDayStart(0);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(5);
    expect(result.getDate()).toBe(7);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it('resetHour=4, AVANT l\'heure de reset (02:00) → la journée d\'hier à 4h', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 7, 2, 0, 0));
    const result = getDayStart(4);
    expect(result.getDate()).toBe(6);
    expect(result.getHours()).toBe(4);
  });

  it('resetHour=4, APRÈS l\'heure de reset (10:00) → la journée courante à 4h', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 7, 10, 0, 0));
    const result = getDayStart(4);
    expect(result.getDate()).toBe(7);
    expect(result.getHours()).toBe(4);
  });

  it('resetHour=4, pile à l\'heure de reset (04:00) → jour courant', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 7, 4, 0, 0));
    const result = getDayStart(4);
    expect(result.getDate()).toBe(7);
    expect(result.getHours()).toBe(4);
  });

  it('gère le passage de mois (1er à 02:00, resetHour=4 → dernier jour du mois précédent)', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 1, 2, 0, 0)); // 1er juin 02:00
    const result = getDayStart(4);
    expect(result.getMonth()).toBe(4); // mai
    expect(result.getDate()).toBe(31);
    expect(result.getHours()).toBe(4);
  });
});

describe('formatTimeAgo', () => {
  const mockT = (key: string, opts?: any) => {
    if (key === 'dashboard.timeLabels.justNow') return 'Just now';
    if (key === 'dashboard.timeLabels.minutesAgo') return `${opts?.count}m ago`;
    if (key === 'dashboard.timeLabels.hoursAgo') return `${opts?.count}h ago`;
    return key;
  };

  it('returns "Just now" for recent scans', () => {
    const now = new Date().toISOString();
    expect(formatTimeAgo(now, mockT)).toBe('Just now');
  });

  it('returns minutes ago for scans within the hour', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(formatTimeAgo(tenMinAgo, mockT)).toBe('10m ago');
  });

  it('returns hours ago for older scans', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(twoHoursAgo, mockT)).toBe('2h ago');
  });
});
