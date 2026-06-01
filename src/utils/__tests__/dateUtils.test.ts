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
  it('returns today at midnight by default', () => {
    const result = getDayStart(0);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it('returns today at 3h when resetHour=3 and current time is after 3h', () => {
    const now = new Date();
    if (now.getHours() >= 3) {
      const result = getDayStart(3);
      expect(result.getHours()).toBe(3);
      expect(result.getDate()).toBe(now.getDate());
    }
  });

  it('returns yesterday at 3h when resetHour=3 and current time is before 3h', () => {
    // This test depends on current time — skipped at 3h+
    const now = new Date();
    if (now.getHours() < 3) {
      const result = getDayStart(3);
      expect(result.getHours()).toBe(3);
      expect(result.getDate()).toBe(now.getDate() - 1);
    }
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
