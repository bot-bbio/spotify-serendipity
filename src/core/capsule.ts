/**
 * Time Capsules: turn the current mad-lib phrase into a track list ready to
 * become a real Spotify playlist. Pure sampling logic — the network side
 * (create / fill / cover) lives in `src/ui/capsule.ts`.
 */

import { weightedPick } from './random.js';
import type { Candidate, Engine } from './serendipity.js';

export interface CapsuleTrack {
  uri: string;
  label: string;
  artist: string;
}

/**
 * Weighted sample (no repeats) of up to `n` playable tracks from a candidate
 * set. Artist/album candidates resolve to their most-played track via
 * {@link Engine.representativeUri}, so every phrase — "an artist I…" included —
 * yields a playlist. Higher play counts weigh heavier, same as Surprise.
 */
export function sampleCapsuleTracks(
  engine: Engine,
  candidates: readonly Candidate[],
  n: number,
  rand: () => number,
): CapsuleTrack[] {
  const pool = [...candidates];
  const seen = new Set<string>();
  const out: CapsuleTrack[] = [];
  while (out.length < n && pool.length > 0) {
    const pick = weightedPick(pool, (c) => Math.max(1, c.count), rand);
    if (!pick) break;
    pool.splice(pool.indexOf(pick), 1);
    const uri = engine.representativeUri(pick);
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    out.push({ uri, label: pick.label, artist: pick.artist });
  }
  return out;
}
