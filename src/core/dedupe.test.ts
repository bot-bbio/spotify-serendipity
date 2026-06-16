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
});
