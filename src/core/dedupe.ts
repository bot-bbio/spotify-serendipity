import type { PlayEvent } from '../types/playevent.js';

/** Default seam window: the same track logged twice within 30s is one play. */
export const DEDUP_WINDOW_MS = 30_000;

const epoch = (e: PlayEvent): number => Date.parse(e.ts);

/**
 * Merge any number of `PlayEvent` sources into one timeline, sorted ascending by
 * timestamp and de-duplicated. Two events collapse when they share a `trackUri`
 * and fall within `windowMs` of each other — this is the seam where the bulk
 * export and the live poll overlap. On a collision the richer record wins:
 * an `export` event (which carries behavioral fields) is preferred over a `live`
 * one. The operation is idempotent, so re-importing is always safe.
 */
export function mergeDedupe(
  events: readonly PlayEvent[],
  windowMs: number = DEDUP_WINDOW_MS,
): PlayEvent[] {
  const sorted = [...events].sort((a, b) => epoch(a) - epoch(b));
  const kept: PlayEvent[] = [];

  for (const ev of sorted) {
    const dup = findDuplicate(kept, ev, windowMs);
    if (dup === -1) {
      kept.push(ev);
    } else if (ev.source === 'export' && kept[dup].source === 'live') {
      kept[dup] = ev; // upgrade to the richer record
    }
    // otherwise: drop `ev` as a duplicate
  }
  return kept;
}

/**
 * Look backwards through the already-kept tail for a same-track event within the
 * window. The tail is time-sorted, so we can stop as soon as we step outside it.
 */
function findDuplicate(kept: PlayEvent[], ev: PlayEvent, windowMs: number): number {
  const t = epoch(ev);
  for (let i = kept.length - 1; i >= 0; i--) {
    if (t - epoch(kept[i]) > windowMs) break;
    if (kept[i].trackUri === ev.trackUri) return i;
  }
  return -1;
}
