/**
 * A single listening event, normalized from the GDPR "Extended Streaming History"
 * export. This is the one shape the entire engine operates on.
 */
export interface PlayEvent {
  /** ISO 8601 timestamp of the play. */
  ts: string;
  /** Milliseconds actually listened. */
  msPlayed: number;
  artist: string;
  track: string;
  /** spotify:track:... — identity, dedup key, and the target we play. */
  trackUri: string;
  album?: string;

  // --- Behavioral context from the export (may be absent on older export vintages).
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

/** The three granularities every applicable query can operate over. */
export type Entity = 'track' | 'album' | 'artist';

/** A play counts as a genuine "stream" (not a skip) past this listen duration. */
export const QUALIFIED_MS = 30_000;
