// @vitest-environment happy-dom
//
// Connected-path reproduction: with Spotify connected and real-format track URIs,
// does a *single* Surprise click render a result card AND its artwork? Covers the
// reported "two clicks / artwork broken when connected" symptoms, exercising the
// real useEnrichment hook with only the network calls stubbed.

import { h } from 'preact';
import { fireEvent, render } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayEvent } from './types/playevent.js';
import { build } from './core/pipeline.js';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
});

// A small dataset with valid base62 track URIs (so parseTrackUri/enrichment fire),
// loaded straight in as the restored dataset on mount.
function makeEvents(): PlayEvent[] {
  const artists = [
    { artist: 'Alpha', album: 'A1', track: 'Atrack', uri: 'spotify:track:AAAAAAAAAAAAAAAAAAAAA1', plays: 60 },
    { artist: 'Beta', album: 'B1', track: 'Btrack', uri: 'spotify:track:BBBBBBBBBBBBBBBBBBBBB2', plays: 40 },
    { artist: 'Gamma', album: 'G1', track: 'Gtrack', uri: 'spotify:track:GGGGGGGGGGGGGGGGGGGGG3', plays: 20 },
    { artist: 'Delta', album: 'D1', track: 'Dtrack', uri: 'spotify:track:DDDDDDDDDDDDDDDDDDDDD4', plays: 8 },
    { artist: 'Epsilon', album: 'E1', track: 'Etrack', uri: 'spotify:track:EEEEEEEEEEEEEEEEEEEEE5', plays: 3 },
  ];
  const out: PlayEvent[] = [];
  let day = 0;
  for (const a of artists) {
    for (let i = 0; i < a.plays; i++) {
      out.push({
        ts: new Date(Date.UTC(2022, 0, 1 + day++)).toISOString(),
        msPlayed: 180_000,
        artist: a.artist,
        track: a.track,
        trackUri: a.uri,
        album: a.album,
        reasonStart: 'clickrow',
        reasonEnd: 'trackdone',
        shuffle: false,
        platform: 'iOS',
        country: 'CA',
      });
    }
  }
  return out;
}

vi.mock('./db/store.js', () => {
  const { dataset } = build(makeEvents());
  return {
    loadDataset: vi.fn().mockResolvedValue({ dataset, events: dataset.columns.n }),
    saveDataset: vi.fn().mockResolvedValue(undefined),
    clearDataset: vi.fn().mockResolvedValue(undefined),
  };
});

// Connected, but idle (no current track) to isolate the suggestion/enrichment path.
vi.mock('./ui/useSpotify.js', () => ({
  useSpotify: () => ({
    configured: true,
    status: 'connected',
    error: null,
    premiumRequired: false,
    position: 0,
    current: null,
    login: vi.fn(),
    logout: vi.fn(),
    play: vi.fn(),
    toggle: vi.fn(),
    seek: vi.fn(),
  }),
}));

// Real enrichment hook, but stub the two network calls it makes.
const { getTrack, getArtist } = vi.hoisted(() => ({
  getTrack: vi.fn().mockResolvedValue({
    id: 't',
    name: 'Atrack',
    album: { name: 'A1', images: [{ url: 'http://art/big', width: 640, height: 640 }, { url: 'http://art/mid', width: 300, height: 300 }] },
    artists: [{ id: 'artist-1', name: 'Alpha' }],
  }),
  getArtist: vi.fn().mockResolvedValue({
    id: 'artist-1',
    name: 'Alpha',
    genres: ['ambient', 'idm'],
    images: [{ url: 'http://artist/big', width: 640, height: 640 }, { url: 'http://artist/mid', width: 320, height: 320 }],
  }),
}));
vi.mock('./api/spotify.js', async (importActual) => {
  const actual = await importActual<typeof import('./api/spotify.js')>();
  return { ...actual, getTrack, getArtist };
});

import { App } from './app.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function clickButton(re: RegExp): void {
  const el = [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
  if (!el) throw new Error(`no button matching ${re}`);
  fireEvent.click(el);
}

function chooseEntity(value: string): void {
  const select = document.querySelector('.lead-row select') as HTMLSelectElement;
  select.value = value;
  fireEvent.change(select);
}

beforeEach(() => {
  mem.clear();
  getTrack.mockClear();
  getArtist.mockClear();
});

describe('connected suggestion + artwork on a single click', () => {
  for (const entity of ['album', 'artist', 'track'] as const) {
    it(`shows a card and artwork on the first Surprise click for ${entity} (connected)`, async () => {
      render(h(App, null));
      await tick(); // loadDataset() resolves the dataset -> 'ready'

      chooseEntity(entity);
      await tick();

      clickButton(/Surprise me/i);
      await tick(); // render the card
      expect(document.querySelector('.card')).toBeTruthy();
      expect(document.querySelector('.card .kind')?.textContent).toBe(entity);

      await tick(); // let the enrichment promise chain settle
      await tick();
      const art = document.querySelector('.card img.art') as HTMLImageElement | null;
      expect(art, 'artwork should appear after enrichment').toBeTruthy();
      expect(art?.src).toMatch(/^http/);
    });
  }
});
