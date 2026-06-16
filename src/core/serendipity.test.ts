import { describe, expect, it } from 'vitest';
import type { PlayEvent } from '../types/playevent.js';
import { buildEngine } from './pipeline.js';

interface GenOpts {
  track?: string;
  startMs: number;
  stepMs?: number;
  ms?: number;
  reasonEnd?: string;
  country?: string;
  platform?: string;
}

/** Generate `n` plays of one artist/track, spaced out so dedup never collapses them. */
function gen(artist: string, n: number, o: GenOpts): PlayEvent[] {
  const track = o.track ?? `${artist} song`;
  const step = o.stepMs ?? 86_400_000;
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(o.startMs + i * step).toISOString(),
    msPlayed: o.ms ?? 120_000,
    artist,
    track,
    trackUri: `spotify:track:${artist}_${track}`.replace(/\s/g, '').toLowerCase(),
    album: `${artist} album`,
    source: 'export' as const,
    reasonEnd: o.reasonEnd ?? 'trackdone',
    country: o.country,
    platform: o.platform,
  }));
}

const labels = (cs: { label: string }[]): string[] => cs.map((c) => c.label);

describe('byFrequency bands', () => {
  const e = buildEngine([
    ...gen('A', 1, { startMs: Date.UTC(2021, 0, 1) }),
    ...gen('B', 5, { startMs: Date.UTC(2021, 1, 1) }),
    ...gen('C', 10, { startMs: Date.UTC(2021, 2, 1) }),
  ]);

  it('puts the heaviest artist in "favorite"', () => {
    expect(labels(e.byFrequency({ entity: 'artist', band: 'favorite' }))).toContain('C');
  });
  it('puts the one-off in "rare"', () => {
    expect(labels(e.byFrequency({ entity: 'artist', band: 'rare' }))).toEqual(['A']);
  });
  it('puts the mid artist in "regular"', () => {
    expect(labels(e.byFrequency({ entity: 'artist', band: 'regular' }))).toContain('B');
  });
});

describe('date / recency queries', () => {
  it('onDate finds artists from a specific calendar day', () => {
    const e = buildEngine([
      ...gen('OnDateGuy', 1, { startMs: Date.UTC(2022, 2, 3, 12) }),
      ...gen('Filler', 1, { startMs: Date.UTC(2022, 7, 9, 12) }),
    ]);
    expect(labels(e.onDate({ entity: 'artist', date: '2022-03-03' }))).toEqual(['OnDateGuy']);
  });

  it('dormant finds only long-silent artists', () => {
    const now = Date.UTC(2025, 0, 1);
    const e = buildEngine(
      [
        ...gen('Old', 3, { startMs: Date.UTC(2020, 0, 1) }),
        ...gen('Fresh', 3, { startMs: Date.UTC(2024, 11, 1) }),
      ],
      now,
    );
    const out = labels(e.dormant({ entity: 'artist', minDays: 365 }));
    expect(out).toContain('Old');
    expect(out).not.toContain('Fresh');
  });

  it('thisDayInHistory matches month-and-day across years', () => {
    const now = Date.UTC(2025, 5, 15, 9);
    const e = buildEngine(
      [
        ...gen('Anniv', 1, { startMs: Date.UTC(2021, 5, 15, 20) }),
        ...gen('Other', 1, { startMs: Date.UTC(2021, 5, 16, 20) }),
      ],
      now,
    );
    expect(labels(e.thisDayInHistory({ entity: 'artist' }))).toEqual(['Anniv']);
  });

  it('mileage ranks by total listening time', () => {
    const e = buildEngine([
      ...gen('Whale', 10, { startMs: Date.UTC(2021, 0, 1), ms: 300_000 }),
      ...gen('Minnow', 2, { startMs: Date.UTC(2021, 6, 1), ms: 60_000 }),
    ]);
    expect(e.mileage({ entity: 'artist' })[0].label).toBe('Whale');
  });

  it('binge finds short-lived obsessions that went dormant', () => {
    const now = Date.UTC(2025, 0, 1);
    const e = buildEngine(
      [
        ...gen('Phase', 8, { startMs: Date.UTC(2021, 0, 1) }), // 8 days, years ago
        ...gen('Steady', 8, { startMs: Date.UTC(2021, 0, 1), stepMs: 120 * 86_400_000 }),
      ],
      now,
    );
    const out = labels(e.binge({ entity: 'artist' }));
    expect(out).toContain('Phase');
    expect(out).not.toContain('Steady');
  });
});

describe('listening-behavior queries', () => {
  it('skipMagnet finds reliably-skipped tracks', () => {
    const e = buildEngine([
      ...gen('SkipArtist', 4, { startMs: Date.UTC(2022, 0, 1), track: 'Skippy', ms: 5_000, reasonEnd: 'fwdbtn' }),
      ...gen('SkipArtist', 2, { startMs: Date.UTC(2022, 3, 1), track: 'Skippy', ms: 200_000 }),
      ...gen('Loved', 6, { startMs: Date.UTC(2022, 0, 1), track: 'Keeper', ms: 200_000 }),
    ]);
    const out = labels(e.skipMagnet({}));
    expect(out).toContain('Skippy');
    expect(out).not.toContain('Keeper');
  });

  it('onRepeat finds tracks played back-to-back-to-back', () => {
    const e = buildEngine([
      ...gen('Looper', 3, { startMs: Date.UTC(2022, 0, 1, 0, 0), track: 'Loop', stepMs: 60_000 }),
      ...gen('Once', 1, { startMs: Date.UTC(2023, 0, 1) }),
    ]);
    expect(labels(e.onRepeat({}))).toContain('Loop');
  });

  it('whileTraveling finds plays outside the home country', () => {
    const e = buildEngine([
      ...gen('Homebody', 3, { startMs: Date.UTC(2022, 0, 1), country: 'CA' }),
      ...gen('Wander', 2, { startMs: Date.UTC(2022, 6, 1), country: 'JP' }),
    ]);
    const out = labels(e.whileTraveling({ entity: 'artist', home: 'CA' }));
    expect(out).toEqual(['Wander']);
  });

  it('byPlatform filters by device', () => {
    const e = buildEngine([
      ...gen('Mobile', 3, { startMs: Date.UTC(2022, 0, 1), platform: 'iOS 17.2' }),
      ...gen('Desktop', 3, { startMs: Date.UTC(2022, 6, 1), platform: 'OS X' }),
    ]);
    expect(labels(e.byPlatform({ entity: 'artist', platform: 'iOS' }))).toEqual(['Mobile']);
  });
});
