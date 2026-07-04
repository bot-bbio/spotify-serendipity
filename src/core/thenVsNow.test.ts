import { describe, expect, it } from 'vitest';
import { computeThenVsNow } from './thenVsNow.js';

const live = (name: string) => ({ name, imageUrl: `http://img/${name}`, url: `http://sp/${name}` });

describe('computeThenVsNow', () => {
  const exportTop = [
    { name: 'Aphex Twin', plays: 900 },
    { name: 'Burial', plays: 400 },
    { name: 'Radiohead', plays: 300 },
  ];
  const allExport = ['Aphex Twin', 'Burial', 'Radiohead', 'Caribou']; // Caribou: played, not top

  it('classifies still / new era / lost', () => {
    const r = computeThenVsNow(exportTop, allExport, [
      live('Aphex Twin'), // in export top -> still
      live('Fred again..'), // never in export -> new era
      live('Caribou'), // in export, but not top: neither still nor new
    ]);
    expect(r.still.map((a) => a.name)).toEqual(['Aphex Twin']);
    expect(r.still[0].playsThen).toBe(900);
    expect(r.newEra.map((a) => a.name)).toEqual(['Fred again..']);
    // Burial + Radiohead are export-top but absent from the live rotation.
    expect(r.lost.map((a) => a.name)).toEqual(['Burial', 'Radiohead']);
  });

  it('matches names case-insensitively', () => {
    const r = computeThenVsNow(exportTop, allExport, [live('APHEX TWIN')]);
    expect(r.still).toHaveLength(1);
    expect(r.newEra).toHaveLength(0);
  });

  it('caps each group at perGroup', () => {
    const manyLive = Array.from({ length: 20 }, (_, i) => live(`New ${i}`));
    const manyExport = Array.from({ length: 20 }, (_, i) => ({ name: `Old ${i}`, plays: i }));
    const r = computeThenVsNow(manyExport, manyExport.map((a) => a.name), manyLive, 6);
    expect(r.newEra).toHaveLength(6);
    expect(r.lost).toHaveLength(6);
  });

  it('is all-empty on empty inputs', () => {
    const r = computeThenVsNow([], [], []);
    expect(r).toEqual({ still: [], newEra: [], lost: [] });
  });
});
