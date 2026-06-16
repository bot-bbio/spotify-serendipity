import { describe, expect, it } from 'vitest';
import { parseExport, type RawExportRecord } from './parser.js';

describe('parseExport', () => {
  it('maps a music row to a PlayEvent', () => {
    const raw: RawExportRecord[] = [
      {
        ts: '2023-06-15T20:00:00Z',
        ms_played: 210_000,
        master_metadata_track_name: 'Nude',
        master_metadata_album_artist_name: 'Radiohead',
        master_metadata_album_album_name: 'In Rainbows',
        spotify_track_uri: 'spotify:track:abc',
        reason_start: 'clickrow',
        reason_end: 'trackdone',
        shuffle: false,
        platform: 'iOS 17.2',
        conn_country: 'CA',
      },
    ];
    const [ev] = parseExport(raw);
    expect(ev).toMatchObject({
      ts: '2023-06-15T20:00:00Z',
      msPlayed: 210_000,
      artist: 'Radiohead',
      track: 'Nude',
      trackUri: 'spotify:track:abc',
      album: 'In Rainbows',
      reasonEnd: 'trackdone',
      shuffle: false,
      platform: 'iOS 17.2',
      country: 'CA',
    });
  });

  it('drops podcasts and rows missing track metadata', () => {
    const raw: RawExportRecord[] = [
      { ts: '2023-01-01T00:00:00Z', ms_played: 1000, spotify_episode_uri: 'spotify:episode:x', episode_name: 'Pod' },
      { ts: '2023-01-02T00:00:00Z', ms_played: 1000, master_metadata_track_name: null, spotify_track_uri: null },
      {
        ts: '2023-01-03T00:00:00Z',
        ms_played: 5000,
        master_metadata_track_name: 'Real',
        master_metadata_album_artist_name: 'Artist',
        spotify_track_uri: 'spotify:track:real',
      },
    ];
    const events = parseExport(raw);
    expect(events).toHaveLength(1);
    expect(events[0].track).toBe('Real');
  });
});
