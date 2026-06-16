import { describe, expect, it } from 'vitest';
import type { PlayEvent } from '../types/playevent.js';
import { decode, encode } from './columnar.js';
import { mergeDedupe } from './dedupe.js';

describe('columnar encode/decode', () => {
  it('round-trips a timeline losslessly', () => {
    const events: PlayEvent[] = [
      {
        ts: new Date(Date.UTC(2021, 4, 1, 10)).toISOString(),
        msPlayed: 200_000,
        artist: 'Burial',
        track: 'Archangel',
        trackUri: 'spotify:track:arch',
        album: 'Untrue',
        reasonStart: 'clickrow',
        reasonEnd: 'trackdone',
        shuffle: true,
        platform: 'iOS',
        country: 'GB',
      },
      {
        ts: new Date(Date.UTC(2021, 4, 2, 11)).toISOString(),
        msPlayed: 12_000,
        artist: 'Four Tet',
        track: 'Angel Echoes',
        trackUri: 'spotify:track:angel',
      },
    ];
    const merged = mergeDedupe(events);
    const restored = decode(encode(merged));
    expect(restored).toEqual(merged);
  });

  it('interns repeated strings into a compact dictionary', () => {
    const events: PlayEvent[] = Array.from({ length: 50 }, (_, i) => ({
      ts: new Date(Date.UTC(2022, 0, 1) + i * 86_400_000).toISOString(),
      msPlayed: 100_000,
      artist: 'Aphex Twin',
      track: 'Xtal',
      trackUri: 'spotify:track:xtal',
    }));
    const ds = encode(events);
    expect(ds.dicts.artists).toEqual(['Aphex Twin']);
    expect(ds.dicts.tracks).toHaveLength(1);
    expect(ds.columns.n).toBe(50);
  });
});
