import { describe, expect, it } from 'vitest';
import { wrapLines } from './cover.js';

// Character-count measure: each char is 10 units wide.
const measure = (s: string): number => s.length * 10;

describe('wrapLines (cover text layout)', () => {
  it('wraps greedily at the max width', () => {
    expect(wrapLines('a song I always skip', 90, measure)).toEqual(['a song I', 'always', 'skip']);
  });

  it('keeps a short phrase on one line', () => {
    expect(wrapLines('a song', 200, measure)).toEqual(['a song']);
  });

  it('emits an over-wide single word alone rather than dropping it', () => {
    expect(wrapLines('supercalifragilistic hit', 100, measure)).toEqual([
      'supercalifragilistic',
      'hit',
    ]);
  });

  it('collapses whitespace and handles the empty string', () => {
    expect(wrapLines('  a   b  ', 500, measure)).toEqual(['a b']);
    expect(wrapLines('', 500, measure)).toEqual([]);
  });
});
