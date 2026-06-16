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
});
