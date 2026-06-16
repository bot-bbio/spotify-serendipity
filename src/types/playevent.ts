/**
 * The canonical, source-agnostic listening event. Both the bulk GDPR export
 * (Path B) and the live `recently-played` poll (Path C) normalize into this shape
 * so the engine never needs to know where a play came from.
 */
export interface PlayEvent {
  /** ISO 8601 timestamp of the play. */
  ts: string;
  /** Milliseconds actually listened (export: exact; live: estimated). */
  msPlayed: number;
  artist: string;
  /** spotify:artist:... — not present in the export (track URI only). */
  artistUri?: string;
  track: string;
  /** spotify:track:... — primary identity and dedup key. */
  trackUri: string;
  album?: string;
  source: Source;

  // --- Behavioral context: present on export events only (the live poll lacks these).
  /** trackdone | fwdbtn | backbtn | clickrow | playbtn | … */
  reasonStart?: string;
  /** trackdone | fwdbtn | endplay | … */
  reasonEnd?: string;
  shuffle?: boolean;
  /** Device / OS string. */
  platform?: string;
  /** conn_country (ISO-3166-1 alpha-2). */
  country?: string;
}

export type Source = 'export' | 'live';

/** The three granularities every applicable query can operate over. */
export type Entity = 'track' | 'album' | 'artist';

/** A play counts as a genuine "stream" (not a skip) past this listen duration. */
export const QUALIFIED_MS = 30_000;
