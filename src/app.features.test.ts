// @vitest-environment happy-dom
//
// End-to-end (network-mocked) flows for the Spotify showcase features:
//   - Time Capsules: phrase -> createPlaylist -> addPlaylistItems -> cover upload
//   - Then vs Now: lazy fetch on expand, still/new/lost classification vs demo data
//   - Card actions: ♥ saved-check + optimistic toggle, add-to-queue
//   - Scope re-consent: 403 insufficient scope surfaces a Reconnect hint

import { h } from 'preact';
import { fireEvent, render } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
});

vi.mock('./db/store.js', () => ({
  loadDataset: vi.fn().mockResolvedValue(null),
  saveDataset: vi.fn().mockResolvedValue(undefined),
  clearDataset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./ui/useEnrichment.js', () => ({ useEnrichment: () => null }));

// Connected, with a track playing so the queue button is available.
vi.mock('./ui/useSpotify.js', () => ({
  useSpotify: () => ({
    configured: true,
    status: 'connected',
    error: null,
    premiumRequired: false,
    position: 1_000,
    volume: 0.8,
    current: {
      paused: false,
      position: 1_000,
      duration: 180_000,
      track_window: {
        current_track: {
          uri: 'spotify:track:x', id: 'x', name: 'Nude', duration_ms: 180_000,
          album: { uri: '', name: 'In Rainbows', images: [{ url: 'http://img/1', width: 64, height: 64 }] },
          artists: [{ uri: '', name: 'Radiohead' }],
        },
      },
    },
    login: vi.fn(), logout: vi.fn(), play: vi.fn(), toggle: vi.fn(), seek: vi.fn(),
    setVolume: vi.fn(), toggleMute: vi.fn(),
  }),
}));

// The cover renderer needs a real canvas; return a fixed payload instead.
vi.mock('./ui/cover.js', async (importActual) => {
  const actual = await importActual<typeof import('./ui/cover.js')>();
  return { ...actual, renderCoverJpeg: vi.fn(async () => 'FAKE_BASE64_JPEG') };
});

const api = vi.hoisted(() => ({
  scopeFail: false,
  createPlaylist: vi.fn(async () => ({ id: 'pl-1', external_urls: { spotify: 'https://open.spotify.com/playlist/pl-1' } })),
  addPlaylistItems: vi.fn(async () => {}),
  uploadPlaylistCover: vi.fn(async () => {}),
  checkLibraryContains: vi.fn(async () => [false]),
  saveToLibrary: vi.fn(async () => {}),
  removeFromLibrary: vi.fn(async () => {}),
  addToQueue: vi.fn(async () => {}),
  getTopArtists: vi.fn(async () => [
    { id: 'a1', name: 'Aphex Twin', images: [{ url: 'http://img/aphex', width: 320, height: 320 }], external_urls: { spotify: 'https://sp/aphex' } },
    { id: 'a2', name: 'Fred again..', images: [], external_urls: { spotify: 'https://sp/fred' } },
  ]),
}));

vi.mock('./api/spotify.js', () => ({
  createPlaylist: (...a: unknown[]) => (api.scopeFail ? Promise.reject({ status: 403, scope: true }) : api.createPlaylist(...(a as []))),
  addPlaylistItems: api.addPlaylistItems,
  uploadPlaylistCover: api.uploadPlaylistCover,
  checkLibraryContains: api.checkLibraryContains,
  saveToLibrary: api.saveToLibrary,
  removeFromLibrary: api.removeFromLibrary,
  addToQueue: api.addToQueue,
  getTopArtists: api.getTopArtists,
  isInsufficientScope: (e: unknown) => !!(e as { scope?: boolean } | null)?.scope,
}));

import { App } from './app.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function clickButton(re: RegExp): HTMLButtonElement {
  const el = [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
  if (!el) throw new Error(`no button matching ${re}`);
  fireEvent.click(el);
  return el as HTMLButtonElement;
}

async function startDemo(): Promise<void> {
  render(h(App, null));
  await tick();
  clickButton(/explore with demo data/i);
  await tick();
}

beforeEach(() => {
  mem.clear();
  api.scopeFail = false;
  api.createPlaylist.mockClear();
  api.addPlaylistItems.mockClear();
  api.uploadPlaylistCover.mockClear();
  api.checkLibraryContains.mockClear();
  api.saveToLibrary.mockClear();
  api.removeFromLibrary.mockClear();
  api.addToQueue.mockClear();
  api.getTopArtists.mockClear();
});

describe('Time Capsules', () => {
  it('creates a private playlist named after the phrase, fills it, and uploads the cover', async () => {
    await startDemo();
    clickButton(/save this phrase as a playlist/i);
    await tick();
    await tick(); // create -> add -> cover

    expect(api.createPlaylist).toHaveBeenCalledTimes(1);
    const [name, description] = api.createPlaylist.mock.calls[0] as unknown as [string, string];
    expect(name).toBe('Serendipity · an artist I play a lot'); // default phrase
    expect(description).toContain('an artist I play a lot');

    const [playlistId, uris] = api.addPlaylistItems.mock.calls[0] as unknown as [string, string[]];
    expect(playlistId).toBe('pl-1');
    expect(uris.length).toBeGreaterThan(0);
    expect(uris.length).toBeLessThanOrEqual(25);
    expect(new Set(uris).size).toBe(uris.length);
    for (const u of uris) expect(u).toMatch(/^spotify:track:/);

    expect(api.uploadPlaylistCover).toHaveBeenCalledWith('pl-1', 'FAKE_BASE64_JPEG');
    const done = document.querySelector('.capsule-done');
    expect(done?.textContent).toMatch(/open the playlist/i);
    expect(done?.querySelector('a')?.getAttribute('href')).toBe(
      'https://open.spotify.com/playlist/pl-1',
    );
  });

  it('offers a reconnect when the session lacks the playlist scopes', async () => {
    api.scopeFail = true;
    await startDemo();
    clickButton(/save this phrase as a playlist/i);
    await tick();
    await tick();
    expect(document.querySelector('.reconnect')?.textContent).toMatch(/reconnect/i);
    expect(api.addPlaylistItems).not.toHaveBeenCalled();
  });
});

describe('Then vs Now', () => {
  it('fetches lazily on expand and classifies against the demo library', async () => {
    await startDemo();
    expect(api.getTopArtists).not.toHaveBeenCalled(); // lazy until opened

    clickButton(/then vs now/i);
    await tick();
    await tick();

    expect(api.getTopArtists).toHaveBeenCalledWith('medium_term');
    const groups = [...document.querySelectorAll('.tvn-group')];
    expect(groups).toHaveLength(3);
    // Aphex Twin is a demo-data heavyweight AND in the live top -> still.
    expect(groups[0].textContent).toContain('Aphex Twin');
    // Fred again.. never appears in the demo data -> new era.
    expect(groups[1].textContent).toContain('Fred again..');
    // Some demo heavyweight is absent from the live top -> lost.
    expect(groups[2].querySelectorAll('li').length).toBeGreaterThan(0);
  });

  it('switching the range fetches that window once and caches it', async () => {
    await startDemo();
    clickButton(/then vs now/i);
    await tick();
    const shortTab = [...document.querySelectorAll('.tvn-ranges .seg')].find(
      (t) => t.textContent === '4 weeks',
    ) as HTMLElement;
    fireEvent.click(shortTab);
    await tick();
    fireEvent.click(shortTab); // re-select: served from cache
    await tick();
    expect(api.getTopArtists).toHaveBeenCalledTimes(2); // medium + short only
  });
});

describe('card actions: ♥ save + queue', () => {
  it('shows the saved state and toggles it optimistically', async () => {
    await startDemo();
    clickButton(/surprise me/i);
    await tick();
    await tick(); // saved-check resolves

    expect(api.checkLibraryContains).toHaveBeenCalledTimes(1);
    const heart = document.querySelector('.heart') as HTMLButtonElement;
    expect(heart).toBeTruthy();
    expect(heart.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(heart);
    expect(heart.getAttribute('aria-pressed')).toBe('true'); // optimistic, pre-await
    await tick();
    expect(api.saveToLibrary).toHaveBeenCalledTimes(1);
    const [uris] = api.saveToLibrary.mock.calls[0] as unknown as [string[]];
    expect(uris[0]).toMatch(/^spotify:track:/);
  });

  it('queues the pick behind the current track', async () => {
    await startDemo();
    clickButton(/surprise me/i);
    await tick();

    const queue = clickButton(/queue/i);
    await tick();
    expect(api.addToQueue).toHaveBeenCalledTimes(1);
    expect(api.addToQueue).toHaveBeenCalledWith(expect.stringMatching(/^spotify:track:/));
    expect(queue.textContent).toMatch(/queued/i);
  });
});
