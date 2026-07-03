import { describe, expect, it } from 'vitest';
import { mmss, relTime, spotifyUrl } from './format.js';

describe('relTime', () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 6, 1);

  it('uses singular units for a rounded count of one (regression: "1 days ago")', () => {
    expect(relTime(now - 1.2 * DAY, now)).toBe('1 day ago');
    expect(relTime(now - 45.2 * DAY, now)).toBe('1 month ago');
  });

  it('keeps plural units and the coarse buckets', () => {
    expect(relTime(now - 0.5 * DAY, now)).toBe('today');
    expect(relTime(now - 3 * DAY, now)).toBe('3 days ago');
    expect(relTime(now - 90 * DAY, now)).toBe('3 months ago');
    expect(relTime(now - 730 * DAY, now)).toBe('2.0 years ago');
  });
});

describe('mmss', () => {
  it('formats milliseconds as m:ss with a zero-padded seconds field', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(5_000)).toBe('0:05');
    expect(mmss(65_000)).toBe('1:05');
    expect(mmss(180_000)).toBe('3:00');
    expect(mmss(599_000)).toBe('9:59');
  });

  it('floors partial seconds and clamps negatives to 0:00', () => {
    expect(mmss(1_999)).toBe('0:01');
    expect(mmss(-100)).toBe('0:00');
  });
});

describe('spotifyUrl', () => {
  it('maps a track URI to an open.spotify.com link', () => {
    expect(spotifyUrl('spotify:track:abc123')).toBe('https://open.spotify.com/track/abc123');
  });
  it('returns undefined for missing or non-matching input', () => {
    expect(spotifyUrl(undefined)).toBeUndefined();
    expect(spotifyUrl('not-a-uri')).toBeUndefined();
  });
});
