import type { Dataset } from './columnar.js';
import type { EntityKind, EntityStat, StatsIndex } from './statsIndex.js';

const DAY = 86_400_000;

export type FrequencyBand = 'obsessed' | 'favorite' | 'regular' | 'occasional' | 'rare';
export type FrequencyMetric = 'count' | 'time';

/** A single result the UI can render and (with `weightedPick`) choose from. */
export interface Candidate {
  kind: EntityKind;
  id: number;
  label: string;
  artist: string;
  /** spotify:track:... — present for tracks; enables deep-link / playback. */
  uri?: string;
  count: number;
  qualified: number;
  totalMs: number;
  first: number;
  last: number;
}

/** Inclusive lower / exclusive upper time bounds, epoch ms. */
export interface TimeRange {
  start: number;
  end: number;
}

/**
 * The serendipity query engine. Holds a dataset + its materialized index and
 * exposes one method per query form. Every method returns an *unranked candidate
 * set*; the caller narrows to a single pick with `weightedPick`. All methods are
 * deterministic and side-effect free.
 */
export class Engine {
  constructor(
    private readonly ds: Dataset,
    private readonly idx: StatsIndex,
    private readonly now: number = Date.now(),
  ) {}

  // ---- Relative-frequency family -----------------------------------------

  byFrequency(opts: {
    entity: EntityKind;
    band: FrequencyBand;
    metric?: FrequencyMetric;
    within?: TimeRange;
  }): Candidate[] {
    const metric = opts.metric ?? 'count';
    const measured = this.measure(opts.entity, metric, opts.within);

    if (opts.band === 'rare') {
      return measured
        .filter((m) => m.playCount > 0 && m.playCount <= 2)
        .map((m) => this.toCandidate(opts.entity, m.stat));
    }

    const ranked = measured.filter((m) => m.playCount > 0).sort((a, b) => a.value - b.value);
    const n = ranked.length;
    const inBand = ranked.filter((_m, i) => {
      const p = n <= 1 ? 1 : i / (n - 1);
      return inPercentileBand(p, opts.band);
    });
    return inBand.map((m) => this.toCandidate(opts.entity, m.stat));
  }

  // ---- Date / recency family ---------------------------------------------

  /** Distinct entities played on a given calendar date (UTC), e.g. '2023-06-15'. */
  onDate(opts: { entity: EntityKind; date: string }): Candidate[] {
    const start = Date.parse(`${opts.date.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(start)) return [];
    return this.candidatesInRange(opts.entity, { start, end: start + DAY });
  }

  /** Entities not played in at least `minDays`. */
  dormant(opts: { entity: EntityKind; minDays: number }): Candidate[] {
    const cutoff = this.now - opts.minDays * DAY;
    return this.entityStats(opts.entity)
      .filter((s) => s.last < cutoff)
      .map((s) => this.toCandidate(opts.entity, s));
  }

  /** Entities played on this month-and-day in any past year. */
  thisDayInHistory(opts: { entity: EntityKind; today?: number }): Candidate[] {
    const d = new Date(opts.today ?? this.now);
    const mmdd = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const indices = this.idx.dayOfYear.get(mmdd);
    if (!indices) return [];
    return this.candidatesFromIndices(opts.entity, indices);
  }

  /** Entities played within a calendar year. */
  fromYear(opts: { entity: EntityKind; year: number }): Candidate[] {
    const start = Date.UTC(opts.year, 0, 1);
    const end = Date.UTC(opts.year + 1, 0, 1);
    return this.candidatesInRange(opts.entity, { start, end });
  }

  /** Earliest discoveries; with `date`, those first heard on that calendar day. */
  firstPlayed(opts: { entity: EntityKind; date?: string }): Candidate[] {
    const stats = this.entityStats(opts.entity);
    if (opts.date) {
      const start = Date.parse(`${opts.date.slice(0, 10)}T00:00:00.000Z`);
      const end = start + DAY;
      return stats
        .filter((s) => s.first >= start && s.first < end)
        .map((s) => this.toCandidate(opts.entity, s));
    }
    return stats.sort((a, b) => a.first - b.first).map((s) => this.toCandidate(opts.entity, s));
  }

  /** The entities you've spent the most total time on. */
  mileage(opts: { entity: EntityKind }): Candidate[] {
    return this.entityStats(opts.entity)
      .sort((a, b) => b.totalMs - a.totalMs)
      .map((s) => this.toCandidate(opts.entity, s));
  }

  // ---- Temporal-pattern family -------------------------------------------

  /** Entities concentrated in an hour-of-day window (UTC), e.g. late-night. */
  byTimeOfDay(opts: { entity: EntityKind; fromHour: number; toHour: number; min?: number }): Candidate[] {
    const min = opts.min ?? 5;
    return this.entityStats(opts.entity)
      .filter((s) => s.count >= min && windowFraction(s.hour, opts.fromHour, opts.toHour, 24) >= 0.4)
      .sort(
        (a, b) =>
          windowFraction(b.hour, opts.fromHour, opts.toHour, 24) -
          windowFraction(a.hour, opts.fromHour, opts.toHour, 24),
      )
      .map((s) => this.toCandidate(opts.entity, s));
  }

  /** Entities concentrated on a weekday (0 = Sunday, UTC). */
  byWeekday(opts: { entity: EntityKind; day: number; min?: number }): Candidate[] {
    const min = opts.min ?? 5;
    return this.entityStats(opts.entity)
      .filter((s) => s.count >= min && s.weekday[opts.day] / s.count >= 0.34)
      .sort((a, b) => b.weekday[opts.day] / b.count - a.weekday[opts.day] / a.count)
      .map((s) => this.toCandidate(opts.entity, s));
  }

  /** Played heavily in a short span, then dropped — the "obsessed for a week" phase. */
  binge(opts: {
    entity: EntityKind;
    maxSpanDays?: number;
    minPlays?: number;
    dormantDays?: number;
  }): Candidate[] {
    const maxSpan = (opts.maxSpanDays ?? 21) * DAY;
    const minPlays = opts.minPlays ?? 5;
    const dormant = (opts.dormantDays ?? 180) * DAY;
    return this.entityStats(opts.entity)
      .filter(
        (s) =>
          s.count >= minPlays && s.last - s.first <= maxSpan && this.now - s.last >= dormant,
      )
      .map((s) => this.toCandidate(opts.entity, s));
  }

  /** Loved, abandoned for a long gap, then returned to. */
  comeback(opts: { entity: EntityKind; gapDays?: number; minPlays?: number }): Candidate[] {
    const gap = (opts.gapDays ?? 180) * DAY;
    const minPlays = opts.minPlays ?? 6;
    const ts = this.ds.columns.ts;
    const out: Candidate[] = [];
    for (const s of this.entityStats(opts.entity)) {
      if (s.count < minPlays) continue;
      let maxGap = 0;
      let afterGap = 0;
      for (let i = 1; i < s.events.length; i++) {
        const g = ts[s.events[i]] - ts[s.events[i - 1]];
        if (g > maxGap) {
          maxGap = g;
          afterGap = s.events.length - i; // plays after the largest gap
        }
      }
      if (maxGap >= gap && afterGap >= 2) out.push(this.toCandidate(opts.entity, s));
    }
    return out;
  }

  /** A low-play track that lives under an artist you otherwise play a lot. */
  deepCut(opts: { maxTrackPlays?: number }): Candidate[] {
    const maxPlays = opts.maxTrackPlays ?? 2;
    const favThreshold = percentile(
      [...this.idx.artist.values()].map((s) => s.qualified),
      0.75,
    );
    const out: Candidate[] = [];
    for (const s of this.idx.track.values()) {
      if (s.count > maxPlays) continue;
      const track = this.ds.dicts.tracks[s.id];
      const artist = this.idx.artist.get(track.artistId);
      if (artist && artist.qualified >= favThreshold && favThreshold > 0) {
        out.push(this.toCandidate('track', s));
      }
    }
    return out;
  }

  // ---- Listening-behavior family (export-only fields) --------------------

  /** Tracks you reliably skip. */
  skipMagnet(opts: { min?: number; ratio?: number }): Candidate[] {
    const min = opts.min ?? 5;
    const ratio = opts.ratio ?? 0.5;
    return this.rankTracks((s) => s.count >= min && s.skipCount / s.count >= ratio, (s) => s.skipCount / s.count);
  }

  /** Tracks you almost always let play to the end. */
  alwaysFinish(opts: { min?: number; ratio?: number }): Candidate[] {
    const min = opts.min ?? 5;
    const ratio = opts.ratio ?? 0.8;
    return this.rankTracks((s) => s.count >= min && s.finishCount / s.count >= ratio, (s) => s.finishCount / s.count);
  }

  /** Tracks you've put on repeat (3+ consecutive plays). */
  onRepeat(opts: { minRuns?: number }): Candidate[] {
    const minRuns = opts.minRuns ?? 1;
    const trackId = this.ds.columns.trackId;
    const runs = new Map<number, number>();
    let runLen = 1;
    for (let i = 1; i < this.ds.columns.n; i++) {
      if (trackId[i] === trackId[i - 1]) {
        runLen++;
        if (runLen === 3) runs.set(trackId[i], (runs.get(trackId[i]) ?? 0) + 1);
      } else {
        runLen = 1;
      }
    }
    return [...runs.entries()]
      .filter(([, r]) => r >= minRuns)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => this.toCandidate('track', this.idx.track.get(id)!));
  }

  /** Entities played on a given platform (substring match, case-insensitive). */
  byPlatform(opts: { entity: EntityKind; platform: string }): Candidate[] {
    const needle = opts.platform.toLowerCase();
    const matchIds = new Set<number>();
    this.ds.dicts.platforms.forEach((name, id) => {
      if (id !== 0 && name.toLowerCase().includes(needle)) matchIds.add(id);
    });
    return this.candidatesWhere(opts.entity, (i) => matchIds.has(this.ds.columns.platform[i]));
  }

  /** Entities played outside the user's home country. */
  whileTraveling(opts: { entity: EntityKind; home: string }): Candidate[] {
    const homeId = this.ds.dicts.countries.indexOf(opts.home);
    return this.candidatesWhere(
      opts.entity,
      (i) => this.ds.columns.country[i] !== 0 && this.ds.columns.country[i] !== homeId,
    );
  }

  // ---- internals ----------------------------------------------------------

  private entityStats(kind: EntityKind): EntityStat[] {
    return [...this.idx[kind].values()];
  }

  private measure(
    kind: EntityKind,
    metric: FrequencyMetric,
    within?: TimeRange,
  ): { stat: EntityStat; value: number; playCount: number }[] {
    const ts = this.ds.columns.ts;
    const ms = this.ds.columns.msPlayed;
    return this.entityStats(kind).map((stat) => {
      if (!within) {
        return { stat, value: metric === 'time' ? stat.totalMs : stat.qualified, playCount: stat.count };
      }
      let plays = 0;
      let qualified = 0;
      let totalMs = 0;
      for (const i of stat.events) {
        if (ts[i] < within.start || ts[i] >= within.end) continue;
        plays++;
        totalMs += ms[i];
        if (ms[i] >= 30_000) qualified++;
      }
      return { stat, value: metric === 'time' ? totalMs : qualified, playCount: plays };
    });
  }

  private rankTracks(keep: (s: EntityStat) => boolean, score: (s: EntityStat) => number): Candidate[] {
    return [...this.idx.track.values()]
      .filter(keep)
      .sort((a, b) => score(b) - score(a))
      .map((s) => this.toCandidate('track', s));
  }

  /** Distinct entities of `kind` referenced by a contiguous ts range. */
  private candidatesInRange(kind: EntityKind, range: TimeRange): Candidate[] {
    const ts = this.ds.columns.ts;
    const n = this.ds.columns.n;
    const lo = lowerBound(ts, n, range.start);
    const hi = lowerBound(ts, n, range.end);
    const indices: number[] = [];
    for (let i = lo; i < hi; i++) indices.push(i);
    return this.candidatesFromIndices(kind, indices);
  }

  private candidatesWhere(kind: EntityKind, keep: (i: number) => boolean): Candidate[] {
    const indices: number[] = [];
    for (let i = 0; i < this.ds.columns.n; i++) if (keep(i)) indices.push(i);
    return this.candidatesFromIndices(kind, indices);
  }

  private candidatesFromIndices(kind: EntityKind, indices: readonly number[]): Candidate[] {
    const seen = new Set<number>();
    const out: Candidate[] = [];
    for (const i of indices) {
      const id = this.entityIdAt(kind, i);
      if (id < 0 || seen.has(id)) continue;
      seen.add(id);
      out.push(this.toCandidate(kind, this.idx[kind].get(id)!));
    }
    return out;
  }

  private entityIdAt(kind: EntityKind, i: number): number {
    const trackId = this.ds.columns.trackId[i];
    if (kind === 'track') return trackId;
    if (kind === 'artist') return this.ds.dicts.tracks[trackId].artistId;
    return this.idx.trackAlbumId[trackId]; // album (-1 when the track has no album)
  }

  private toCandidate(kind: EntityKind, s: EntityStat): Candidate {
    const base = { kind, id: s.id, count: s.count, qualified: s.qualified, totalMs: s.totalMs, first: s.first, last: s.last };
    if (kind === 'artist') {
      const name = this.ds.dicts.artists[s.id];
      return { ...base, label: name, artist: name };
    }
    if (kind === 'track') {
      const t = this.ds.dicts.tracks[s.id];
      return { ...base, label: t.name, artist: this.ds.dicts.artists[t.artistId], uri: t.uri };
    }
    const lbl = this.idx.albumLabels.get(s.id)!;
    return { ...base, label: lbl.album, artist: this.ds.dicts.artists[lbl.artistId] };
  }
}

// ---- pure helpers ---------------------------------------------------------

function inPercentileBand(p: number, band: FrequencyBand): boolean {
  switch (band) {
    case 'obsessed':
      return p >= 0.95;
    case 'favorite':
      return p >= 0.75;
    case 'regular':
      return p >= 0.4 && p < 0.75;
    case 'occasional':
      return p >= 0.1 && p < 0.4;
    case 'rare':
      return false; // handled separately (absolute tail)
  }
}

/** Value at the given quantile of an unsorted numeric list (0 if empty). */
function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function windowFraction(hist: Uint32Array, from: number, to: number, mod: number): number {
  let inWin = 0;
  let total = 0;
  for (let h = 0; h < hist.length; h++) {
    total += hist[h];
    const within = from <= to ? h >= from && h <= to : h >= from || h <= to; // wrap past midnight
    if (within) inWin += hist[h];
  }
  void mod;
  return total === 0 ? 0 : inWin / total;
}

/** First index whose value >= `value` in an ascending array (binary search). */
function lowerBound(arr: Float64Array, n: number, value: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
