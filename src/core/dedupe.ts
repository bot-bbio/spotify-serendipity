import type { PlayEvent } from '../types/playevent.js';

/** Default window: the same track logged twice within 30s counts as one play. */
export const DEDUP_WINDOW_MS = 30_000;

const epoch = (e: PlayEvent): number => Date.parse(e.ts);

/**
 * Sort all events ascending by timestamp and drop duplicates — the same `trackUri`
 * within `windowMs`. This keeps multi-file imports and re-imports idempotent, and
 * leaves the timeline in the ts-sorted order the columnar store expects.
 *
 * Worst case is O(N log N) for the sort plus O(N) for the pass. Because events are
 * processed in ascending-ts order, the most recently *kept* play of a track is
 * always the nearest in time, so a single map lookup decides duplication — there is
 * no tail back-scan to degrade to O(N²) when thousands of plays share a timestamp
 * (VULN-002).
 */
export function mergeDedupe(
  events: readonly PlayEvent[],
  windowMs: number = DEDUP_WINDOW_MS,
): PlayEvent[] {
  const sorted = [...events].sort((a, b) => epoch(a) - epoch(b));
  const kept: PlayEvent[] = [];
  // trackUri -> epoch of its most recently kept play. The window is measured
  // against the last *kept* play (not the last seen), matching the original
  // back-scan that stopped at `kept` entries only.
  const lastKept = new Map<string, number>();
  for (const ev of sorted) {
    const t = epoch(ev);
    const prev = lastKept.get(ev.trackUri);
    if (prev !== undefined && t - prev <= windowMs) continue; // duplicate within window
    kept.push(ev);
    lastKept.set(ev.trackUri, t);
  }
  return kept;
}
