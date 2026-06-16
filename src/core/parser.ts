import type { PlayEvent } from '../types/playevent.js';

/**
 * One record from a Spotify "Extended Streaming History" export file
 * (`Streaming_History_Audio_*.json`). Only the fields we consume are typed;
 * the export carries more. Field availability varies slightly by export vintage,
 * so every field beyond `ts`/`ms_played` is treated as optional.
 */
export interface RawExportRecord {
  ts: string;
  ms_played: number;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
  master_metadata_album_album_name?: string | null;
  spotify_track_uri?: string | null;
  reason_start?: string | null;
  reason_end?: string | null;
  shuffle?: boolean | null;
  platform?: string | null;
  conn_country?: string | null;
  // Podcast/episode plays carry these instead of track metadata; we skip them.
  spotify_episode_uri?: string | null;
  episode_name?: string | null;
}

/**
 * Normalize raw export records into `PlayEvent`s. Non-music rows (podcasts,
 * and rows missing a track URI or title) are dropped — this tool is about music.
 */
export function parseExport(records: readonly RawExportRecord[]): PlayEvent[] {
  const out: PlayEvent[] = [];
  for (const r of records) {
    if (!isMusicRow(r)) continue;
    out.push({
      ts: r.ts,
      msPlayed: r.ms_played ?? 0,
      artist: r.master_metadata_album_artist_name as string,
      track: r.master_metadata_track_name as string,
      trackUri: r.spotify_track_uri as string,
      album: r.master_metadata_album_album_name ?? undefined,
      source: 'export',
      reasonStart: r.reason_start ?? undefined,
      reasonEnd: r.reason_end ?? undefined,
      shuffle: r.shuffle ?? undefined,
      platform: r.platform ?? undefined,
      country: r.conn_country ?? undefined,
    });
  }
  return out;
}

function isMusicRow(r: RawExportRecord): boolean {
  return (
    typeof r.ts === 'string' &&
    !!r.spotify_track_uri &&
    r.spotify_track_uri.startsWith('spotify:track:') &&
    !!r.master_metadata_track_name &&
    !!r.master_metadata_album_artist_name
  );
}
