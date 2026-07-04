import { describe, expect, it } from 'vitest';
import type { PlayEvent } from '../types/playevent.js';
import { buildEngine } from './pipeline.js';
import { rng } from './random.js';
import { sampleCapsuleTracks } from './capsule.js';

function gen(artist: string, track: string, n: number, startMs: number): PlayEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(startMs + i * 86_400_000).toISOString(),
    msPlayed: 120_000,
    artist,
    track,
    trackUri: `spotify:track:${artist}_${track}`.replace(/\s/g, '').toLowerCase(),
    album: `${artist} album`,
    reasonEnd: 'trackdone',
  }));
}

describe('sampleCapsuleTracks', () => {
  const engine = buildEngine([
    ...gen('Alpha', 'Hit', 30, Date.UTC(2021, 0, 1)),
    ...gen('Alpha', 'Deep', 2, Date.UTC(2021, 6, 1)),
    ...gen('Beta', 'Song', 12, Date.UTC(2021, 2, 1)),
    ...gen('Gamma', 'Tune', 6, Date.UTC(2021, 4, 1)),
  ]);

  it('samples distinct, playable tracks up to n', () => {
    const candidates = engine.mileage({ entity: 'track' });
    const tracks = sampleCapsuleTracks(engine, candidates, 3, rng(7));
    expect(tracks.length).toBe(3);
    const uris = tracks.map((t) => t.uri);
    expect(new Set(uris).size).toBe(3);
    for (const u of uris) expect(u).toMatch(/^spotify:track:/);
  });

  it('resolves artist candidates to their most-played track', () => {
    const candidates = engine.mileage({ entity: 'artist' });
    const tracks = sampleCapsuleTracks(engine, candidates, 3, rng(7));
    // All three artists appear once each, Alpha via its heavy rotation track.
    expect(tracks.map((t) => t.uri)).toContain('spotify:track:alpha_hit');
    expect(tracks.map((t) => t.uri)).not.toContain('spotify:track:alpha_deep');
    expect(new Set(tracks.map((t) => t.artist)).size).toBe(3);
  });

  it('returns fewer than n when the pool is smaller, and [] for an empty pool', () => {
    const candidates = engine.mileage({ entity: 'artist' }); // 3 artists
    expect(sampleCapsuleTracks(engine, candidates, 25, rng(1)).length).toBe(3);
    expect(sampleCapsuleTracks(engine, [], 25, rng(1))).toEqual([]);
  });
});
