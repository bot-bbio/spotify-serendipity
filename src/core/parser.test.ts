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

  // VULN-001: a non-parseable `ts` survived isMusicRow and later crashed
  // `new Date(NaN).toISOString()` / silently broke the ts-sorted invariant.
  it('drops rows whose timestamp is not a parseable date', () => {
    const raw: RawExportRecord[] = [
      {
        ts: 'not-a-date',
        ms_played: 5000,
        master_metadata_track_name: 'Garbage TS',
        master_metadata_album_artist_name: 'Artist',
        spotify_track_uri: 'spotify:track:bad',
      },
      {
        ts: '2023-01-03T00:00:00Z',
        ms_played: 5000,
        master_metadata_track_name: 'Good',
        master_metadata_album_artist_name: 'Artist',
        spotify_track_uri: 'spotify:track:good',
      },
    ];
    const events = parseExport(raw);
    expect(events).toHaveLength(1);
    expect(events[0].track).toBe('Good');
    // The surviving row's ts is parseable, so the columnar invariant holds.
    expect(Number.isFinite(Date.parse(events[0].ts))).toBe(true);
  });

  // VULN-010: untrusted `ms_played` must not reach the Int32 column unsanitized
  // (a huge value would wrap negative via `x | 0`; a non-number would corrupt it).
  it('sanitizes ms_played: non-finite -> 0, negative -> 0, oversized -> clamped', () => {
    const make = (ms: unknown): RawExportRecord => ({
      ts: '2023-01-01T00:00:00Z',
      ms_played: ms as number,
      master_metadata_track_name: 'T',
      master_metadata_album_artist_name: 'A',
      spotify_track_uri: 'spotify:track:x',
    });
    expect(parseExport([make(undefined)])[0].msPlayed).toBe(0);
    expect(parseExport([make('123')])[0].msPlayed).toBe(0); // string is not trusted
    expect(parseExport([make(-1000)])[0].msPlayed).toBe(0);
    expect(parseExport([make(Number.NaN)])[0].msPlayed).toBe(0);
    expect(parseExport([make(1e30)])[0].msPlayed).toBe(2_147_483_647);
    expect(parseExport([make(210_000.9)])[0].msPlayed).toBe(210_000); // truncated
  });
});
