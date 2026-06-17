import { describe, expect, it } from 'vitest';
import type { PlayEvent } from '../types/playevent.js';
import { mergeDedupe } from './dedupe.js';

const base = (over: Partial<PlayEvent> & Pick<PlayEvent, 'ts' | 'trackUri'>): PlayEvent => ({
  msPlayed: 120_000,
  artist: 'A',
  track: 'T',
  ...over,
});

describe('mergeDedupe', () => {
  it('collapses the same track within the 30s window', () => {
    const out = mergeDedupe([
      base({ ts: '2023-01-01T00:00:00Z', trackUri: 'spotify:track:x' }),
      base({ ts: '2023-01-01T00:00:10Z', trackUri: 'spotify:track:x' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps distinct tracks and the same track outside the window', () => {
    const out = mergeDedupe([
      base({ ts: '2023-01-01T00:00:00Z', trackUri: 'spotify:track:x' }),
      base({ ts: '2023-01-01T00:00:05Z', trackUri: 'spotify:track:y' }),
      base({ ts: '2023-01-01T00:05:00Z', trackUri: 'spotify:track:x' }),
    ]);
    expect(out).toHaveLength(3);
  });

  it('sorts ascending and collapses duplicates regardless of input order', () => {
    const out = mergeDedupe([
      base({ ts: '2023-01-02T00:00:00Z', trackUri: 'spotify:track:z' }),
      base({ ts: '2023-01-01T00:00:05Z', trackUri: 'spotify:track:x' }),
      base({ ts: '2023-01-01T00:00:00Z', trackUri: 'spotify:track:x' }),
    ]);
    expect(out.map((e) => e.ts)).toEqual(['2023-01-01T00:00:00Z', '2023-01-02T00:00:00Z']);
  });

  // The window is measured against the last *kept* play, not the last seen one:
  // 0s is kept, 20s is dropped (≤30s from 0s), 40s is kept (>30s from the kept 0s,
  // even though it is only 20s from the dropped 20s). Locks the O(N) rewrite to the
  // original back-scan semantics (VULN-002).
  it('measures the window against the last kept play, not the last seen', () => {
    const out = mergeDedupe([
      base({ ts: '2023-01-01T00:00:00Z', trackUri: 'spotify:track:x' }),
      base({ ts: '2023-01-01T00:00:20Z', trackUri: 'spotify:track:x' }),
      base({ ts: '2023-01-01T00:00:40Z', trackUri: 'spotify:track:x' }),
    ]);
    expect(out.map((e) => e.ts)).toEqual([
      '2023-01-01T00:00:00Z',
      '2023-01-01T00:00:40Z',
    ]);
  });

  // VULN-002: thousands of distinct tracks sharing one timestamp used to make the
  // backward scan never break -> O(N²). They are all distinct, so all are kept; this
  // exercises the pathological input and must stay fast (linear).
  it('keeps a large burst of distinct tracks at an identical timestamp', () => {
    const n = 20_000;
    const events = Array.from({ length: n }, (_, i) =>
      base({ ts: '2023-01-01T00:00:00Z', trackUri: `spotify:track:t${i}` }),
    );
    const started = performance.now();
    const out = mergeDedupe(events);
    const elapsedMs = performance.now() - started;
    expect(out).toHaveLength(n);
    // Old quadratic code measured ~893ms for 20k; linear should be well under this.
    expect(elapsedMs).toBeLessThan(500);
  });
});
