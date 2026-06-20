// @vitest-environment happy-dom
//
// Reproduction probe for the connected-path duplication: with the player bar
// rendered (a live `current` state), does operating the mad-lib UI append a
// second app root? Drives demo -> Surprise -> switch group while "connected".

import { h } from 'preact';
import { render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./db/store.js', () => ({
  loadDataset: vi.fn().mockResolvedValue(null),
  saveDataset: vi.fn().mockResolvedValue(undefined),
  clearDataset: vi.fn().mockResolvedValue(undefined),
}));

// Connected, with a track playing (so the PlayerBar renders) the whole time.
vi.mock('./ui/useSpotify.js', () => ({
  useSpotify: () => ({
    configured: true,
    status: 'connected',
    error: null,
    premiumRequired: false,
    position: 1_000,
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
  }),
}));

// Enrichment makes network calls when connected; stub it to stay offline.
vi.mock('./ui/useEnrichment.js', () => ({ useEnrichment: () => null }));

import { App } from './app.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const clickButton = (re: RegExp): void => {
  [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))!.click();
};

describe('connected-path duplication probe', () => {
  it('operating with the player bar present keeps one app root', async () => {
    render(h(App, null));
    await tick();
    clickButton(/explore with demo data/i);
    await tick();
    expect(document.querySelector('.playerbar')).toBeTruthy(); // bar is showing
    expect(document.querySelectorAll('main.app').length).toBe(1);

    for (let i = 0; i < 4; i++) {
      clickButton(/Surprise me/i);
      await tick();
      const tab = [...document.querySelectorAll('.seg')].find(
        (t) => t.getAttribute('aria-selected') === 'false',
      ) as HTMLElement | undefined;
      tab?.click();
      await tick();
    }
    expect(document.querySelectorAll('main.app').length).toBe(1);
  });
});
