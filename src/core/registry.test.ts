import { describe, expect, it } from 'vitest';
import { makeSynthetic } from '../fixtures/synthetic.js';
import { buildEngine } from './pipeline.js';
import { descriptorsFor, REGISTRY } from './registry.js';

describe('query registry', () => {
  const engine = buildEngine(makeSynthetic(4000, 7), Date.UTC(2025, 5, 15));

  it('every descriptor runs against synthetic data without throwing', () => {
    for (const d of REGISTRY) {
      const entity = d.entities[0];
      const param =
        d.param === 'date' ? '2022-06-15'
        : d.param === 'year' ? 2022
        : d.param === 'duration' ? 180
        : d.param === 'choice' ? d.choices![0].value
        : undefined;
      const result = d.run(engine, { entity, param });
      expect(Array.isArray(result)).toBe(true);
    }
  });

  it('every choice descriptor declares options and runs for each of them', () => {
    const choiceDescriptors = REGISTRY.filter((d) => d.param === 'choice');
    expect(choiceDescriptors.length).toBeGreaterThan(0);
    for (const d of choiceDescriptors) {
      expect(d.choices!.length).toBeGreaterThanOrEqual(2);
      for (const c of d.choices!) {
        expect(Array.isArray(d.run(engine, { entity: d.entities[0], param: c.value }))).toBe(true);
      }
    }
  });

  it('behavior phrases are track-only; frequency phrases apply to artists', () => {
    const trackIds = descriptorsFor('track').map((d) => d.id);
    const artistIds = descriptorsFor('artist').map((d) => d.id);
    expect(trackIds).toContain('skip');
    expect(artistIds).not.toContain('skip');
    expect(artistIds).toContain('freq-favorite');
    // one-hit is the inverse: artist-only, absent from tracks.
    expect(artistIds).toContain('one-hit');
    expect(trackIds).not.toContain('one-hit');
  });

  it('top-year scopes the frequency ranking to the given year', () => {
    const d = REGISTRY.find((x) => x.id === 'top-year')!;
    // Synthetic data spans 2019–2025, so a mid-range year must produce candidates
    // and an out-of-range year must not.
    expect(d.run(engine, { entity: 'artist', param: 2022 }).length).toBeGreaterThan(0);
    expect(d.run(engine, { entity: 'artist', param: 1999 })).toEqual([]);
  });

  it('at least one frequency band yields a pick on a realistic distribution', () => {
    const favorites = REGISTRY.find((d) => d.id === 'freq-favorite')!.run(engine, { entity: 'artist' });
    expect(favorites.length).toBeGreaterThan(0);
  });
});
