import { QUALIFIED_MS } from '../types/playevent.js';
import type { Dataset } from './columnar.js';

export type EntityKind = 'track' | 'album' | 'artist';

/**
 * Per-entity aggregates plus the entity's full timeline (`events`, an inverted
 * list of column indices in ascending-ts order). Almost every query reads these
 * precomputed stats instead of rescanning the raw columns.
 */
export interface EntityStat {
  id: number;
  /** Total plays (including skips). */
  count: number;
  /** Plays that passed the {@link QUALIFIED_MS} "real listen" bar. */
  qualified: number;
  totalMs: number;
  first: number; // epoch ms
  last: number; // epoch ms
  distinctTracks: number;
  /** Plays that were skipped (fwdbtn or sub-threshold). */
  skipCount: number;
  /** Plays that ran to the end (reasonEnd === trackdone). */
  finishCount: number;
  hour: Uint32Array; // length 24 (local hour-of-day)
  weekday: Uint32Array; // length 7 (0 = Sunday, local time)
  month: Uint32Array; // length 12 (0 = January, local time)
  events: number[]; // column indices, ascending ts
}

export interface StatsIndex {
  n: number;
  track: Map<number, EntityStat>;
  album: Map<number, EntityStat>;
  artist: Map<number, EntityStat>;
  /** Resolves a synthetic albumId back to its artist + album name. */
  albumLabels: Map<number, { artistId: number; album: string }>;
  /** trackId -> albumId (or -1), so an event resolves to its album in O(1). */
  trackAlbumId: Int32Array;
  /** 'MM-DD' -> column indices, for "this day in history". */
  dayOfYear: Map<string, number[]>;
}

/** Build the full materialized index in a single O(N) pass over the columns. */
export function buildIndex(ds: Dataset): StatsIndex {
  const { columns: c, dicts } = ds;
  const idx: StatsIndex = {
    n: c.n,
    track: new Map(),
    album: new Map(),
    artist: new Map(),
    albumLabels: new Map(),
    trackAlbumId: new Int32Array(dicts.tracks.length).fill(-1),
    dayOfYear: new Map(),
  };

  // Synthetic album id space keyed by (artistId, albumName).
  const albumIds = new Map<string, number>();
  // Temp sets to count distinct tracks per artist/album without keeping them.
  const artistTracks = new Map<number, Set<number>>();
  const albumTracks = new Map<number, Set<number>>();

  for (let i = 0; i < c.n; i++) {
    const t = c.ts[i];
    const ms = c.msPlayed[i];
    const trackId = c.trackId[i];
    const track = dicts.tracks[trackId];
    const artistId = track.artistId;
    // Time-of-day / weekday / calendar-day buckets are derived in the *local*
    // timezone of the device. The user thinks of "late-night" or "on this day"
    // in their own wall-clock time; an export timestamp of 04:00Z is 11pm the
    // previous evening for a UTC-5 listener, so bucketing in UTC would misfile it.
    const d = new Date(t);
    const hour = d.getHours();
    const weekday = d.getDay();
    const month = d.getMonth();
    const skipped = ms < QUALIFIED_MS || dicts.reasons[c.reasonEnd[i]] === 'fwdbtn';
    const finished = dicts.reasons[c.reasonEnd[i]] === 'trackdone';

    bump(idx.track, trackId, i, t, ms, hour, weekday, month, skipped, finished);
    bump(idx.artist, artistId, i, t, ms, hour, weekday, month, skipped, finished);
    addDistinct(artistTracks, artistId, trackId);

    if (track.album !== null) {
      // NUL delimits the numeric artist id from the album name so the composite
      // key can't collide (album names never contain NUL). Written as the \0
      // escape to keep this source file plain ASCII rather than an embedded byte.
      const key = `${artistId}\0${track.album}`;
      let albumId = albumIds.get(key);
      if (albumId === undefined) {
        albumId = albumIds.size;
        albumIds.set(key, albumId);
        idx.albumLabels.set(albumId, { artistId, album: track.album });
      }
      idx.trackAlbumId[trackId] = albumId;
      bump(idx.album, albumId, i, t, ms, hour, weekday, month, skipped, finished);
      addDistinct(albumTracks, albumId, trackId);
    }

    const mmdd = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const bucket = idx.dayOfYear.get(mmdd);
    if (bucket) bucket.push(i);
    else idx.dayOfYear.set(mmdd, [i]);
  }

  // Tracks are their own distinct unit.
  for (const s of idx.track.values()) s.distinctTracks = 1;
  for (const [id, set] of artistTracks) idx.artist.get(id)!.distinctTracks = set.size;
  for (const [id, set] of albumTracks) idx.album.get(id)!.distinctTracks = set.size;

  return idx;
}

function bump(
  map: Map<number, EntityStat>,
  id: number,
  i: number,
  t: number,
  ms: number,
  hour: number,
  weekday: number,
  month: number,
  skipped: boolean,
  finished: boolean,
): void {
  let s = map.get(id);
  if (s === undefined) {
    s = {
      id,
      count: 0,
      qualified: 0,
      totalMs: 0,
      first: t,
      last: t,
      distinctTracks: 0,
      skipCount: 0,
      finishCount: 0,
      hour: new Uint32Array(24),
      weekday: new Uint32Array(7),
      month: new Uint32Array(12),
      events: [],
    };
    map.set(id, s);
  }
  s.count++;
  if (ms >= QUALIFIED_MS) s.qualified++;
  s.totalMs += ms;
  if (t < s.first) s.first = t;
  if (t > s.last) s.last = t;
  if (skipped) s.skipCount++;
  if (finished) s.finishCount++;
  s.hour[hour]++;
  s.weekday[weekday]++;
  s.month[month]++;
  s.events.push(i); // ascending ts, since we iterate columns in order
}

function addDistinct(map: Map<number, Set<number>>, id: number, trackId: number): void {
  let set = map.get(id);
  if (set === undefined) {
    set = new Set();
    map.set(id, set);
  }
  set.add(trackId);
}

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
