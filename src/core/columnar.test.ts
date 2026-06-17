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

  // VULN-003: the reason column is a Uint8Array, so >255 distinct reason values
  // would overflow the dict index and silently mis-map (id 256 -> 0). Encoding must
  // fail closed instead. Real exports have ~10 reasons; 256 means malformed/hostile.
  it('rejects a reason dictionary wider than its Uint8 column', () => {
    const events: PlayEvent[] = Array.from({ length: 256 }, (_, i) => ({
      ts: new Date(Date.UTC(2022, 0, 1) + i * 1000).toISOString(),
      msPlayed: 1000,
      artist: 'A',
      track: `T${i}`,
      trackUri: `spotify:track:t${i}`,
      reasonStart: `reason-${i}`, // 256 distinct reasons + the reserved "none"
    }));
    expect(() => encode(events)).toThrow(/distinct reason/i);
  });

  it('accepts a reason dictionary that exactly fills the Uint8 column', () => {
    // 255 distinct reasons + the reserved id-0 "none" = 256 ids, the column's max.
    const events: PlayEvent[] = Array.from({ length: 255 }, (_, i) => ({
      ts: new Date(Date.UTC(2022, 0, 1) + i * 1000).toISOString(),
      msPlayed: 1000,
      artist: 'A',
      track: `T${i}`,
      trackUri: `spotify:track:t${i}`,
      reasonStart: `reason-${i}`,
    }));
    expect(() => encode(events)).not.toThrow();
  });
});
