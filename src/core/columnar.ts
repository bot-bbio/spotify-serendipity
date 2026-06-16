import type { PlayEvent } from '../types/playevent.js';

/**
 * Columnar, dictionary-encoded representation of a listening history.
 *
 * Storing hundreds of thousands of `PlayEvent` objects is wasteful — the same
 * artist/track/album/URI strings repeat endlessly, and a row-per-event IndexedDB
 * store is slow to read back. Instead we intern every string into a dictionary and
 * keep the events as parallel typed arrays (structure-of-arrays). This cuts memory
 * ~15x, makes IndexedDB a handful of ArrayBuffer blobs, and turns scans into tight
 * cache-friendly numeric loops. The `ts` column is kept sorted ascending so date
 * ranges resolve by binary search.
 */
export interface Dicts {
  /** artistId -> name */
  artists: string[];
  /** trackId -> track descriptor */
  tracks: TrackRef[];
  /** index 0 reserved for "none" */
  platforms: string[];
  /** index 0 reserved for "none" */
  countries: string[];
  /** index 0 reserved for "none"; shared by reasonStart/reasonEnd */
  reasons: string[];
}

export interface TrackRef {
  name: string;
  artistId: number;
  uri: string;
  album: string | null;
}

export interface Columns {
  n: number;
  ts: Float64Array; // epoch ms, ascending
  msPlayed: Int32Array;
  trackId: Int32Array;
  reasonStart: Uint8Array; // dict index, 0 = none
  reasonEnd: Uint8Array; // dict index, 0 = none
  shuffle: Uint8Array; // 0 unknown, 1 false, 2 true
  platform: Uint16Array; // dict index, 0 = none
  country: Uint16Array; // dict index, 0 = none
}

export interface Dataset {
  columns: Columns;
  dicts: Dicts;
}

/** Intern helper: map a string to a stable integer id, growing the backing list. */
class Interner {
  private readonly map = new Map<string, number>();
  constructor(private readonly list: string[], seedNone = false) {
    if (seedNone) this.intern(''); // reserve id 0 for "none"
  }
  intern(s: string): number {
    let id = this.map.get(s);
    if (id === undefined) {
      id = this.list.length;
      this.list.push(s);
      this.map.set(s, id);
    }
    return id;
  }
  /** Intern an optional value, returning 0 ("none") for undefined/null. */
  internOpt(s: string | undefined | null): number {
    return s == null ? 0 : this.intern(s);
  }
}

/**
 * Encode a timeline into the columnar form. Input is assumed time-sorted and
 * de-duplicated (see {@link mergeDedupe}); the `ts` column inherits that order.
 */
export function encode(events: readonly PlayEvent[]): Dataset {
  const n = events.length;
  const dicts: Dicts = {
    artists: [],
    tracks: [],
    platforms: [],
    countries: [],
    reasons: [],
  };
  const artistI = new Interner(dicts.artists);
  const platformI = new Interner(dicts.platforms, true);
  const countryI = new Interner(dicts.countries, true);
  const reasonI = new Interner(dicts.reasons, true);
  const trackIds = new Map<string, number>(); // trackUri -> trackId

  const columns: Columns = {
    n,
    ts: new Float64Array(n),
    msPlayed: new Int32Array(n),
    trackId: new Int32Array(n),
    reasonStart: new Uint8Array(n),
    reasonEnd: new Uint8Array(n),
    shuffle: new Uint8Array(n),
    platform: new Uint16Array(n),
    country: new Uint16Array(n),
  };

  for (let i = 0; i < n; i++) {
    const e = events[i];
    let trackId = trackIds.get(e.trackUri);
    if (trackId === undefined) {
      trackId = dicts.tracks.length;
      dicts.tracks.push({
        name: e.track,
        artistId: artistI.intern(e.artist),
        uri: e.trackUri,
        album: e.album ?? null,
      });
      trackIds.set(e.trackUri, trackId);
    }
    columns.ts[i] = Date.parse(e.ts);
    columns.msPlayed[i] = e.msPlayed | 0;
    columns.trackId[i] = trackId;
    columns.reasonStart[i] = reasonI.internOpt(e.reasonStart);
    columns.reasonEnd[i] = reasonI.internOpt(e.reasonEnd);
    columns.shuffle[i] = e.shuffle === undefined ? 0 : e.shuffle ? 2 : 1;
    columns.platform[i] = platformI.internOpt(e.platform);
    columns.country[i] = countryI.internOpt(e.country);
  }

  return { columns, dicts };
}

/** Reconstruct `PlayEvent`s from the columnar form (used in tests and on export). */
export function decode(ds: Dataset): PlayEvent[] {
  const { columns: c, dicts } = ds;
  const out: PlayEvent[] = new Array(c.n);
  for (let i = 0; i < c.n; i++) {
    const track = dicts.tracks[c.trackId[i]];
    const ev: PlayEvent = {
      ts: new Date(c.ts[i]).toISOString(),
      msPlayed: c.msPlayed[i],
      artist: dicts.artists[track.artistId],
      track: track.name,
      trackUri: track.uri,
    };
    if (track.album !== null) ev.album = track.album;
    if (c.reasonStart[i] !== 0) ev.reasonStart = dicts.reasons[c.reasonStart[i]];
    if (c.reasonEnd[i] !== 0) ev.reasonEnd = dicts.reasons[c.reasonEnd[i]];
    if (c.shuffle[i] !== 0) ev.shuffle = c.shuffle[i] === 2;
    if (c.platform[i] !== 0) ev.platform = dicts.platforms[c.platform[i]];
    if (c.country[i] !== 0) ev.country = dicts.countries[c.country[i]];
    out[i] = ev;
  }
  return out;
}
