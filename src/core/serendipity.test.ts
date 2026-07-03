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

describe('temporal-pattern queries', () => {
  // Mid-month, midday-UTC timestamps keep the local calendar month stable for
  // any runner timezone within UTC±11 (the index buckets in local time).
  it('bySeason finds summer-concentrated artists, including a wrap past New Year', () => {
    const e = buildEngine([
      ...gen('SummerGuy', 6, { startMs: Date.UTC(2022, 6, 10, 12), stepMs: 86_400_000 }),
      ...gen('WinterGuy', 6, { startMs: Date.UTC(2022, 11, 15, 12), stepMs: 12 * 86_400_000 }),
    ]);
    const summer = labels(e.bySeason({ entity: 'artist', fromMonth: 5, toMonth: 7 }));
    expect(summer).toContain('SummerGuy');
    expect(summer).not.toContain('WinterGuy');
    // Winter wraps Dec -> Feb (11 -> 1).
    const winter = labels(e.bySeason({ entity: 'artist', fromMonth: 11, toMonth: 1 }));
    expect(winter).toContain('WinterGuy');
    expect(winter).not.toContain('SummerGuy');
  });

  it('discovered keeps only recent first-plays', () => {
    const now = Date.UTC(2025, 0, 1);
    const e = buildEngine(
      [
        ...gen('NewFind', 3, { startMs: Date.UTC(2024, 11, 15), stepMs: 3_600_000 }),
        ...gen('OldNews', 3, { startMs: Date.UTC(2020, 0, 1) }),
      ],
      now,
    );
    const out = labels(e.discovered({ entity: 'artist', withinDays: 30 }));
    expect(out).toEqual(['NewFind']);
  });

  it('thisDayInHistory excludes plays from the current year (regression)', () => {
    const now = Date.UTC(2025, 5, 15, 12);
    const e = buildEngine(
      [
        ...gen('PastYears', 1, { startMs: Date.UTC(2021, 5, 15, 12) }),
        ...gen('Today', 1, { startMs: Date.UTC(2025, 5, 15, 12) }),
      ],
      now,
    );
    expect(labels(e.thisDayInHistory({ entity: 'artist' }))).toEqual(['PastYears']);
  });
});

describe('library-shape queries', () => {
  it('oneHitWonder finds artists dominated by a single track', () => {
    const e = buildEngine([
      ...gen('OneHit', 9, { startMs: Date.UTC(2022, 0, 1), track: 'The Hit' }),
      ...gen('OneHit', 1, { startMs: Date.UTC(2022, 6, 1), track: 'B Side' }),
      ...gen('Varied', 5, { startMs: Date.UTC(2022, 0, 1), track: 'Cut One' }),
      ...gen('Varied', 5, { startMs: Date.UTC(2022, 3, 1), track: 'Cut Two' }),
    ]);
    const out = labels(e.oneHitWonder());
    expect(out).toContain('OneHit');
    expect(out).not.toContain('Varied');
  });

  it('byPlatform accepts a family of needles (phone = iOS or Android)', () => {
    const e = buildEngine([
      ...gen('IPhone', 2, { startMs: Date.UTC(2022, 0, 1), platform: 'iOS 17.2' }),
      ...gen('Droid', 2, { startMs: Date.UTC(2022, 2, 1), platform: 'Android OS 14' }),
      ...gen('Desk', 2, { startMs: Date.UTC(2022, 4, 1), platform: 'OS X' }),
    ]);
    const out = labels(e.byPlatform({ entity: 'artist', platform: ['ios', 'android'] }));
    expect(out).toContain('IPhone');
    expect(out).toContain('Droid');
    expect(out).not.toContain('Desk');
  });

  it('whileTraveling infers home as the modal country when omitted', () => {
    const e = buildEngine([
      ...gen('Homebody', 3, { startMs: Date.UTC(2022, 0, 1), country: 'CA' }),
      ...gen('Wander', 2, { startMs: Date.UTC(2022, 6, 1), country: 'JP' }),
    ]);
    expect(labels(e.whileTraveling({ entity: 'artist' }))).toEqual(['Wander']);
  });

  it('whileTraveling is empty when the export has no country data', () => {
    const e = buildEngine(gen('NoCountry', 3, { startMs: Date.UTC(2022, 0, 1) }));
    expect(e.whileTraveling({ entity: 'artist' })).toEqual([]);
  });
});

describe('dataset introspection', () => {
  const e = buildEngine([
    ...gen('First', 1, { startMs: Date.UTC(2021, 2, 10, 12) }),
    ...gen('Last', 1, { startMs: Date.UTC(2023, 8, 20, 12) }),
  ]);

  it('yearsAvailable spans first to last event year inclusive', () => {
    expect(e.yearsAvailable()).toEqual([2021, 2022, 2023]);
  });

  it('dateRange reports the first/last event days (UTC)', () => {
    expect(e.dateRange()).toEqual({ min: '2021-03-10', max: '2023-09-20' });
  });

  it('both are empty/null on an empty dataset', () => {
    const empty = buildEngine([]);
    expect(empty.yearsAvailable()).toEqual([]);
    expect(empty.dateRange()).toBeNull();
  });
});

describe('representativeUri (playback target)', () => {
  const e = buildEngine([
    ...gen('Rep', 3, { startMs: Date.UTC(2022, 0, 1), track: 'Hit' }),
    ...gen('Rep', 1, { startMs: Date.UTC(2022, 6, 1), track: 'Obscure' }),
  ]);

  it('resolves an artist to its most-played track URI', () => {
    const [artist] = e.mileage({ entity: 'artist' });
    expect(e.representativeUri(artist)).toBe('spotify:track:rep_hit');
  });

  it('resolves a track to its own URI', () => {
    const top = e.mileage({ entity: 'track' })[0];
    expect(e.representativeUri(top)).toBe(top.uri);
  });
});
