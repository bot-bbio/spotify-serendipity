// @vitest-environment happy-dom
//
// Bug #2 regression: clicking "Play here" played audio but surfaced *no* controls
// (not even play/pause), because the player bar only renders when the SDK state
// reaches the UI. This mounts the app with a connected hook exposing a live
// `current` state and asserts the full transport renders and its controls fire.

import { h } from 'preact';
import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

const toggle = vi.fn();
const seek = vi.fn();

vi.mock('./db/store.js', () => ({
  loadDataset: vi.fn().mockResolvedValue(null),
  saveDataset: vi.fn().mockResolvedValue(undefined),
  clearDataset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./ui/useSpotify.js', () => ({
  useSpotify: () => ({
    configured: true,
    status: 'connected',
    error: null,
    premiumRequired: false,
    position: 65_000,
    current: {
      paused: false,
      position: 65_000,
      duration: 180_000,
      track_window: {
        current_track: {
          uri: 'spotify:track:x',
          id: 'x',
          name: 'Weird Fishes',
          duration_ms: 180_000,
          album: { uri: '', name: 'In Rainbows', images: [{ url: 'http://img/1', width: 64, height: 64 }] },
          artists: [{ uri: '', name: 'Radiohead' }],
        },
      },
    },
    login: vi.fn(),
    logout: vi.fn(),
    play: vi.fn(),
    toggle,
    seek,
  }),
}));

import { App } from './app.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('in-browser player controls', () => {
  it('renders a full transport (play/pause + seek + time) and wires its controls', async () => {
    render(h(App, null));
    await tick(); // loadDataset() -> 'empty'
    [...document.querySelectorAll('button')]
      .find((b) => /explore with demo data/i.test(b.textContent ?? ''))!
      .click();
    await tick(); // -> 'ready'; mocked hook already reports a playing track

    // The bar and all three control affordances are present.
    const bar = document.querySelector('.playerbar');
    expect(bar).toBeTruthy();
    expect(bar?.querySelector('.pb-title')?.textContent).toBe('Weird Fishes');
    expect(bar?.querySelector('.pb-artist')?.textContent).toBe('Radiohead');

    const times = [...document.querySelectorAll('.pb-time')].map((t) => t.textContent);
    expect(times).toEqual(['1:05', '3:00']); // elapsed / total

    const range = document.querySelector('.pb-seek') as HTMLInputElement;
    expect(range).toBeTruthy();
    expect(range.value).toBe('65000');
    expect(range.max).toBe('180000');

    const toggleBtn = document.querySelector('.pb-toggle') as HTMLButtonElement;
    expect(toggleBtn.getAttribute('aria-label')).toBe('Pause'); // playing -> shows pause

    // Controls are wired to the hook.
    fireEvent.click(toggleBtn);
    expect(toggle).toHaveBeenCalledTimes(1);

    fireEvent.input(range, { target: { value: '30000' } });
    expect(seek).toHaveBeenCalledWith(30_000);
  });
});
