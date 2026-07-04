import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth.js', () => ({
  getValidAccessToken: vi.fn(async () => 'test-token'),
  invalidateAccessToken: vi.fn(),
}));

import {
  addPlaylistItems,
  addToQueue,
  checkLibraryContains,
  createPlaylist,
  getTopArtists,
  isInsufficientScope,
  parseTrackUri,
  removeFromLibrary,
  retryDelayMs,
  saveToLibrary,
  SpotifyApiError,
  uploadPlaylistCover,
} from './spotify.js';

/** fetch stub capturing the last request; responds with `status` + `body`. */
function stubFetch(status = 200, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(status === 204 ? null : JSON.stringify(body), { status });
    }),
  );
  return calls;
}

describe('endpoint contracts (per the OpenAPI schema)', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('createPlaylist POSTs /me/playlists with a private-playlist body', async () => {
    const calls = stubFetch(201, { id: 'pl1', external_urls: { spotify: 'https://x' } });
    const created = await createPlaylist('My Capsule', 'desc');
    expect(calls[0].url).toBe('https://api.spotify.com/v1/me/playlists');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'My Capsule',
      description: 'desc',
      public: false,
    });
    expect(created.id).toBe('pl1');
  });

  it('addPlaylistItems POSTs the /items endpoint (not /tracks) with a uris body', async () => {
    const calls = stubFetch(201, {});
    await addPlaylistItems('pl1', ['spotify:track:a', 'spotify:track:b']);
    expect(calls[0].url).toBe('https://api.spotify.com/v1/playlists/pl1/items');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      uris: ['spotify:track:a', 'spotify:track:b'],
    });
  });

  it('addPlaylistItems refuses more than the API limit of 100', async () => {
    stubFetch();
    const many = Array.from({ length: 101 }, (_, i) => `spotify:track:${i}`);
    expect(() => addPlaylistItems('pl1', many)).toThrow(RangeError);
  });

  it('uploadPlaylistCover PUTs raw base64 with an image/jpeg content type', async () => {
    const calls = stubFetch(202, undefined);
    await uploadPlaylistCover('pl1', 'QkFTRTY0');
    expect(calls[0].url).toBe('https://api.spotify.com/v1/playlists/pl1/images');
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.body).toBe('QkFTRTY0');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
  });

  it('library save/check/remove use the consolidated /me/library endpoints', async () => {
    let calls = stubFetch(200, undefined);
    await saveToLibrary(['spotify:track:a']);
    expect(calls[0].url).toBe('https://api.spotify.com/v1/me/library?uris=spotify%3Atrack%3Aa');
    expect(calls[0].init.method).toBe('PUT');

    calls = stubFetch(200, [true]);
    await expect(checkLibraryContains(['spotify:track:a'])).resolves.toEqual([true]);
    expect(calls[0].url).toBe(
      'https://api.spotify.com/v1/me/library/contains?uris=spotify%3Atrack%3Aa',
    );

    calls = stubFetch(200, undefined);
    await removeFromLibrary(['spotify:track:a']);
    expect(calls[0].init.method).toBe('DELETE');
  });

  it('library helpers enforce the 1–40 URI bound', async () => {
    stubFetch();
    expect(() => saveToLibrary([])).toThrow(RangeError);
    expect(() => checkLibraryContains(Array.from({ length: 41 }, () => 'u'))).toThrow(RangeError);
  });

  it('addToQueue POSTs the uri (and device when given) as query params', async () => {
    const calls = stubFetch(204, undefined);
    await addToQueue('spotify:track:a', 'dev1');
    expect(calls[0].url).toBe(
      'https://api.spotify.com/v1/me/player/queue?uri=spotify%3Atrack%3Aa&device_id=dev1',
    );
    expect(calls[0].init.method).toBe('POST');
  });

  it('getTopArtists GETs /me/top/artists with the affinity window', async () => {
    const calls = stubFetch(200, { items: [{ id: 'a1', name: 'X', images: [], external_urls: { spotify: 'https://x' } }] });
    const items = await getTopArtists('short_term', 10);
    expect(calls[0].url).toBe(
      'https://api.spotify.com/v1/me/top/artists?time_range=short_term&limit=10',
    );
    expect(items[0].name).toBe('X');
  });
});

describe('isInsufficientScope', () => {
  it('matches only 403s that mention scope', () => {
    expect(isInsufficientScope(new SpotifyApiError(403, 'Insufficient client scope'))).toBe(true);
    expect(isInsufficientScope(new SpotifyApiError(403, 'Player command failed'))).toBe(false);
    expect(isInsufficientScope(new SpotifyApiError(401, 'scope'))).toBe(false);
    expect(isInsufficientScope(new Error('scope'))).toBe(false);
  });
});

describe('retryDelayMs (rate-limit backoff)', () => {
  it('honors a numeric Retry-After header (seconds → ms), capped', () => {
    expect(retryDelayMs(0, '2')).toBe(2000);
    expect(retryDelayMs(5, '1')).toBe(1000); // header wins over the exponential term
    expect(retryDelayMs(0, '9999', 500, 20_000)).toBe(20_000); // capped
  });

  it('falls back to capped exponential backoff without a header', () => {
    expect(retryDelayMs(0, null, 500, 20_000)).toBe(500);
    expect(retryDelayMs(1, null, 500, 20_000)).toBe(1000);
    expect(retryDelayMs(2, null, 500, 20_000)).toBe(2000);
    expect(retryDelayMs(10, null, 500, 20_000)).toBe(20_000); // capped
  });

  it('ignores a non-numeric Retry-After and uses backoff', () => {
    expect(retryDelayMs(0, 'soon', 500, 20_000)).toBe(500);
  });
});

describe('parseTrackUri', () => {
  it('extracts the id from a track URI', () => {
    expect(parseTrackUri('spotify:track:6rqhFgbbKwnb9MLmUQDhG6')).toBe('6rqhFgbbKwnb9MLmUQDhG6');
  });

  it('rejects non-track URIs', () => {
    expect(parseTrackUri('spotify:artist:abc')).toBeNull();
    expect(parseTrackUri('spotify:track:bad id!')).toBeNull();
    expect(parseTrackUri('https://open.spotify.com/track/abc')).toBeNull();
  });
});
