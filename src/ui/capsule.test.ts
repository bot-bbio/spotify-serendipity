import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEngine } from '../core/pipeline.js';
import { REGISTRY_BY_ID } from '../core/registry.js';
import { rng } from '../core/random.js';
import type { PlayEvent } from '../types/playevent.js';
import { CapsuleError, createTimeCapsule } from './capsule.js';

const api = vi.hoisted(() => ({
  createPlaylist: vi.fn(async () => ({
    id: 'pl-1',
    external_urls: { spotify: 'https://open.spotify.com/playlist/pl-1' },
  })),
  addPlaylistItems: vi.fn(async () => {}),
  uploadPlaylistCover: vi.fn(async () => {}),
}));

vi.mock('../api/spotify.js', () => ({
  ...api,
  safeSpotifyUrl: (u: string | undefined) =>
    u !== undefined && u.startsWith('https://open.spotify.com/') ? u : undefined,
}));
vi.mock('./cover.js', () => ({ renderCoverJpeg: vi.fn(async () => 'FAKE_JPEG') }));

function gen(artist: string, track: string, n: number, startMs: number): PlayEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(startMs + i * 86_400_000).toISOString(),
    msPlayed: 120_000,
    artist,
    track,
    trackUri: `spotify:track:${artist}_${track}`.replace(/\s/g, '').toLowerCase(),
    album: `${artist} album`,
    reasonEnd: 'trackdone',
  }));
}

const descriptor = REGISTRY_BY_ID.get('mileage')!;

beforeEach(() => {
  api.createPlaylist.mockClear();
  api.addPlaylistItems.mockClear();
  api.uploadPlaylistCover.mockClear();
});

describe('createTimeCapsule', () => {
  it('refuses to create a playlist when the phrase yields a single track', async () => {
    // One artist, one track: every entity view of this phrase resolves to 1 uri.
    const engine = buildEngine(gen('Solo', 'Only Song', 10, Date.UTC(2021, 0, 1)));
    await expect(
      createTimeCapsule({ engine, descriptor, entity: 'artist', param: undefined, rand: rng(1) }),
    ).rejects.toSatisfy((e) => e instanceof CapsuleError && /only one track/i.test(e.message));
    expect(api.createPlaylist).not.toHaveBeenCalled();
    expect(api.addPlaylistItems).not.toHaveBeenCalled();
  });

  it('names the playlist from the naming schema, with the sentence in the description', async () => {
    const engine = buildEngine([
      ...gen('Alpha', 'Hit', 30, Date.UTC(2021, 0, 1)),
      ...gen('Beta', 'Song', 12, Date.UTC(2021, 2, 1)),
    ]);
    const result = await createTimeCapsule({
      engine,
      descriptor,
      entity: 'track',
      param: undefined,
      rand: rng(1),
    });
    expect(result.trackCount).toBe(2);
    const [name, description] = api.createPlaylist.mock.calls[0] as unknown as [string, string];
    expect(name).toBe('Most hours logged');
    expect(description).toContain("I've spent the most hours on");
  });
});
