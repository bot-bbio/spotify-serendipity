import type { PlayEvent } from '../types/playevent.js';

/** Default window: the same track logged twice within 30s counts as one play. */
export const DEDUP_WINDOW_MS = 30_000;

const epoch = (e: PlayEvent): number => Date.parse(e.ts);

/**
 * Sort all events ascending by timestamp and drop duplicates — the same `trackUri`
 * within `windowMs`. This keeps multi-file imports and re-imports idempotent, and
 * leaves the timeline in the ts-sorted order the columnar store expects.
 */
export function mergeDedupe(
  events: readonly PlayEvent[],
  windowMs: number = DEDUP_WINDOW_MS,
): PlayEvent[] {
  const sorted = [...events].sort((a, b) => epoch(a) - epoch(b));
  const kept: PlayEvent[] = [];
  for (const ev of sorted) {
    if (findDuplicate(kept, ev, windowMs) === -1) kept.push(ev);
  }
  return kept;
}

/**
 * Look back through the time-sorted tail for a same-track event within the window,
 * stopping as soon as we step outside it.
 */
function findDuplicate(kept: PlayEvent[], ev: PlayEvent, windowMs: number): number {
  const t = epoch(ev);
  for (let i = kept.length - 1; i >= 0; i--) {
    if (t - epoch(kept[i]) > windowMs) break;
    if (kept[i].trackUri === ev.trackUri) return i;
  }
  return -1;
}
