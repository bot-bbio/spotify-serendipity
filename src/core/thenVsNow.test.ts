import { describe, expect, it } from 'vitest';
import { computeThenVsNow, NEW_ERA_MAX_PLAYS } from './thenVsNow.js';

const live = (name: string, artist?: string) => ({
  name,
  artist,
  imageUrl: `http://img/${name}`,
  url: `http://sp/${name}`,
});

describe('computeThenVsNow', () => {
  const exportTop = [
    { name: 'Aphex Twin', plays: 900 },
    { name: 'Burial', plays: 400 },
    { name: 'Radiohead', plays: 300 },
  ];
  // Caribou: played plenty, but not top. Four Tet: a stray play or two only.
  const allExport = [
    ...exportTop,
    { name: 'Caribou', plays: 120 },
    { name: 'Four Tet', plays: NEW_ERA_MAX_PLAYS },
  ];

  it('classifies still / new era / lost', () => {
    const r = computeThenVsNow(exportTop, allExport, [
      live('Aphex Twin'), // in export top -> still
      live('Fred again..'), // never in export -> new era
      live('Caribou'), // in export, meaningful plays, not top: neither still nor new
    ]);
    expect(r.still.map((a) => a.name)).toEqual(['Aphex Twin']);
    expect(r.still[0].playsThen).toBe(900);
    expect(r.newEra.map((a) => a.name)).toEqual(['Fred again..']);
    // Burial + Radiohead are export-top but absent from the live rotation.
    expect(r.lost.map((a) => a.name)).toEqual(['Burial', 'Radiohead']);
  });

  it('counts a barely-played export item as new era (threshold, not strict absence)', () => {
    const r = computeThenVsNow(exportTop, allExport, [live('Four Tet')]);
    expect(r.newEra.map((a) => a.name)).toEqual(['Four Tet']);
  });

  it('does not count an item above the threshold as new era', () => {
    const overThreshold = [...allExport, { name: 'Actress', plays: NEW_ERA_MAX_PLAYS + 1 }];
    const r = computeThenVsNow(exportTop, overThreshold, [live('Actress')]);
    expect(r.newEra).toHaveLength(0);
  });

  it('matches names case-insensitively', () => {
    const r = computeThenVsNow(exportTop, allExport, [live('APHEX TWIN')]);
    expect(r.still).toHaveLength(1);
    expect(r.newEra).toHaveLength(0);
  });

  it('joins songs by name AND artist, so same-named tracks stay distinct', () => {
    const top = [{ name: 'Intro', artist: 'The xx', plays: 250 }];
    const r = computeThenVsNow(top, top, [
      live('Intro', 'The xx'), // same song -> still
      live('Intro', 'M83'), // different artist, same title -> new era
    ]);
    expect(r.still.map((a) => a.artist)).toEqual(['The xx']);
    expect(r.newEra.map((a) => a.artist)).toEqual(['M83']);
  });

  it('caps each group at perGroup', () => {
    const manyLive = Array.from({ length: 20 }, (_, i) => live(`New ${i}`));
    const manyExport = Array.from({ length: 20 }, (_, i) => ({ name: `Old ${i}`, plays: i + 10 }));
    const r = computeThenVsNow(manyExport, manyExport, manyLive, 6);
    expect(r.newEra).toHaveLength(6);
    expect(r.lost).toHaveLength(6);
  });

  it('is all-empty on empty inputs', () => {
    const r = computeThenVsNow([], [], []);
    expect(r).toEqual({ still: [], newEra: [], lost: [] });
  });
});
