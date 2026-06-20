import { describe, expect, it } from 'vitest';
import type { PlayEvent } from '../types/playevent.js';
import { build } from './pipeline.js';

const day = (n: number): string => new Date(Date.UTC(2022, 5, n, 12)).toISOString();

const events: PlayEvent[] = [
  { ts: day(1), msPlayed: 120_000, artist: 'X', track: 'T1', trackUri: 'spotify:track:t1', album: 'XA', reasonEnd: 'trackdone' },
  { ts: day(2), msPlayed: 120_000, artist: 'X', track: 'T1', trackUri: 'spotify:track:t1', album: 'XA', reasonEnd: 'trackdone' },
  { ts: day(3), msPlayed: 5_000, artist: 'X', track: 'T1', trackUri: 'spotify:track:t1', album: 'XA', reasonEnd: 'fwdbtn' },
  { ts: day(4), msPlayed: 200_000, artist: 'X', track: 'T2', trackUri: 'spotify:track:t2', album: 'XA', reasonEnd: 'trackdone' },
  { ts: day(5), msPlayed: 90_000, artist: 'Y', track: 'U1', trackUri: 'spotify:track:u1', album: 'YA', reasonEnd: 'trackdone' },
];

describe('buildIndex', () => {
  const { index } = build(events);

  it('aggregates artist stats correctly', () => {
    const x = [...index.artist.values()].find((s) => s.distinctTracks === 2)!;
    expect(x.count).toBe(4); // 3 plays of T1 + 1 of T2
    expect(x.qualified).toBe(3); // the 5s play is below threshold
    expect(x.skipCount).toBe(1); // fwdbtn / sub-threshold
    expect(x.finishCount).toBe(3); // trackdone plays
    expect(x.distinctTracks).toBe(2);
  });

  it('tracks are their own distinct unit', () => {
    for (const s of index.track.values()) expect(s.distinctTracks).toBe(1);
  });

  it('records every event in the day-of-year index', () => {
    const total = [...index.dayOfYear.values()].reduce((a, b) => a + b.length, 0);
    expect(total).toBe(events.length);
    expect(index.dayOfYear.get('06-01')).toHaveLength(1);
  });

  it('keeps per-entity timelines ascending', () => {
    for (const s of index.artist.values()) {
      const ts = s.events.map((i) => build(events).dataset.columns.ts[i]);
      expect(ts).toEqual([...ts].sort((a, b) => a - b));
    }
  });

  // Regression for the UTC-bucketing bug: time-of-day / weekday / day-of-year
  // must reflect the user's *local* wall clock, not UTC, or "late-night",
  // "on Sundays", and "on this day" queries land in the wrong bucket.
  it('buckets hour / weekday / day-of-year by local time, not UTC', () => {
    // Sanity-check that the suite TZ pin (src/test/setup.ts) is active: a summer
    // date proves a constant UTC-5 (offset 300 min), distinguishing it from a
    // DST zone. If this fails, the rest of the assertions are not meaningful.
    expect(new Date('2022-07-01T00:00:00Z').getTimezoneOffset()).toBe(300);

    // 03:00Z on 2022-06-01 is 22:00 on 2022-05-31 at UTC-5 — a different hour,
    // weekday, and calendar day than the UTC reading would give.
    const ts = Date.UTC(2022, 5, 1, 3, 0);
    const d = new Date(ts);
    const { index: idx } = build([
      { ts: d.toISOString(), msPlayed: 120_000, artist: 'Z', track: 'Zt', trackUri: 'spotify:track:z', album: 'ZA', reasonEnd: 'trackdone' },
    ]);
    const stat = [...idx.artist.values()][0];

    // Filed under the local bucket…
    expect(stat.hour[d.getHours()]).toBe(1); // 22:00 local
    expect(stat.weekday[d.getDay()]).toBe(1); // Tuesday (May 31)
    const pad = (n: number): string => String(n).padStart(2, '0');
    expect(idx.dayOfYear.get(`${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)).toHaveLength(1); // 05-31

    // …and explicitly NOT the UTC bucket it would have landed in before the fix.
    expect(stat.hour[d.getUTCHours()]).toBe(0); // not 03:00
    expect(idx.dayOfYear.get('06-01')).toBeUndefined(); // not the UTC calendar day
  });
});
