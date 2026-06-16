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
        d.param === 'date' ? '2022-06-15' : d.param === 'year' ? 2022 : d.param === 'duration' ? 180 : undefined;
      const result = d.run(engine, { entity, param });
      expect(Array.isArray(result)).toBe(true);
    }
  });

  it('behavior phrases are track-only; frequency phrases apply to artists', () => {
    const trackIds = descriptorsFor('track').map((d) => d.id);
    const artistIds = descriptorsFor('artist').map((d) => d.id);
    expect(trackIds).toContain('skip');
    expect(artistIds).not.toContain('skip');
    expect(artistIds).toContain('freq-favorite');
  });

  it('at least one frequency band yields a pick on a realistic distribution', () => {
    const favorites = REGISTRY.find((d) => d.id === 'freq-favorite')!.run(engine, { entity: 'artist' });
    expect(favorites.length).toBeGreaterThan(0);
  });
});
