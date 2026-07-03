// @vitest-environment happy-dom
//
// Regressions for the live "player bar frozen on the previous track" report:
// audio transitioned but the visuals didn't. Two mechanisms are locked here:
//  1. play(uri) must wait for the SDK state of the *requested* track — on any
//     play after the first, getCurrentState() immediately returns the still-
//     playing previous track, and seeding from that froze the bar.
//  2. The reconcile loop must converge the UI when `player_state_changed`
//     never fires (the SDK drops it for some API-initiated changes).

import { h } from 'preact';
import { act, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpotifyHook } from './useSpotify.js';

const mocks = vi.hoisted(() => {
  const getCurrentState = vi.fn<() => Promise<Spotify.PlaybackState | null>>();
  const setVolume = vi.fn(() => Promise.resolve());
  const controller = {
    deviceId: 'device-1',
    togglePlay: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    seek: vi.fn(() => Promise.resolve()),
    getCurrentState,
    setVolume,
    getVolume: vi.fn(() => Promise.resolve(0.8)),
    disconnect: vi.fn(),
  };
  return { controller, getCurrentState, setVolume, playTracks: vi.fn(() => Promise.resolve()) };
});

vi.mock('../api/auth.js', () => ({
  AuthError: class AuthError extends Error {},
  beginLogin: vi.fn(() => Promise.resolve()),
  completeLoginFromRedirect: vi.fn(() => Promise.resolve()),
  isLoggedIn: () => true,
  logout: vi.fn(),
}));
vi.mock('../api/config.js', () => ({ SPOTIFY_CLIENT_ID: 'test-client' }));
vi.mock('../api/playback.js', () => ({ initPlayer: vi.fn(() => Promise.resolve(mocks.controller)) }));
vi.mock('../api/spotify.js', () => ({
  playTracks: mocks.playTracks,
  SpotifyApiError: class SpotifyApiError extends Error {
    status = 0;
  },
}));

import { useSpotify } from './useSpotify.js';

let hook!: SpotifyHook;
function Probe() {
  hook = useSpotify();
  return null;
}

function mkState(uri: string, over: Partial<Spotify.PlaybackState> = {}): Spotify.PlaybackState {
  return {
    paused: false,
    position: 1_000,
    duration: 180_000,
    track_window: {
      current_track: {
        uri,
        id: uri.split(':')[2],
        name: uri,
        duration_ms: 180_000,
        album: { uri: '', name: '', images: [] },
        artists: [],
      },
    },
    ...over,
  } as Spotify.PlaybackState;
}

const shownUri = (): string | undefined => hook.current?.track_window.current_track.uri;

async function mount(): Promise<void> {
  render(h(Probe, null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0); // settle the OAuth-callback effect
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getCurrentState.mockReset();
  mocks.playTracks.mockClear();
  mocks.setVolume.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('play() seeds the bar with the requested track, not the previous one', () => {
  it('polls past stale device states until the new uri is reported', async () => {
    await mount();
    const stale = mkState('spotify:track:old');
    const fresh = mkState('spotify:track:new');
    // The device keeps reporting the old track for two polls (real transition lag).
    let calls = 0;
    mocks.getCurrentState.mockImplementation(async () => (++calls <= 2 ? stale : fresh));

    await act(async () => {
      const p = hook.play('spotify:track:new');
      await vi.advanceTimersByTimeAsync(2_500); // ≥ 8 polls × 250 ms
      await p;
    });

    expect(mocks.playTracks).toHaveBeenCalledWith('device-1', ['spotify:track:new']);
    expect(shownUri()).toBe('spotify:track:new'); // pre-fix: froze on :old
  });
});

describe('reconcile loop converges the UI without player_state_changed', () => {
  it('picks up a track change from polled SDK state within ~1s', async () => {
    await mount();
    const first = mkState('spotify:track:a');
    mocks.getCurrentState.mockResolvedValue(first);
    await act(async () => {
      const p = hook.play('spotify:track:a');
      await vi.advanceTimersByTimeAsync(500);
      await p;
    });
    expect(shownUri()).toBe('spotify:track:a');

    // Audio moves on to track b; the SDK never fires an event.
    mocks.getCurrentState.mockResolvedValue(mkState('spotify:track:b'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(shownUri()).toBe('spotify:track:b');
  });

  it('picks up an external pause the same way', async () => {
    await mount();
    mocks.getCurrentState.mockResolvedValue(mkState('spotify:track:a'));
    await act(async () => {
      const p = hook.play('spotify:track:a');
      await vi.advanceTimersByTimeAsync(500);
      await p;
    });
    expect(hook.current?.paused).toBe(false);

    mocks.getCurrentState.mockResolvedValue(mkState('spotify:track:a', { paused: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(hook.current?.paused).toBe(true);
  });
});

describe('volume controls', () => {
  it('sets, clamps, and round-trips mute/unmute through the controller', async () => {
    await mount();
    mocks.getCurrentState.mockResolvedValue(mkState('spotify:track:a'));
    await act(async () => {
      const p = hook.play('spotify:track:a'); // creates the controller
      await vi.advanceTimersByTimeAsync(500);
      await p;
    });
    expect(hook.volume).toBe(0.8); // synced from the device on init

    await act(async () => {
      await hook.setVolume(0.3);
    });
    expect(mocks.setVolume).toHaveBeenCalledWith(0.3);
    expect(hook.volume).toBe(0.3);

    await act(async () => {
      await hook.toggleMute();
    });
    expect(hook.volume).toBe(0);
    expect(mocks.setVolume).toHaveBeenCalledWith(0);

    await act(async () => {
      await hook.toggleMute(); // restores the last non-zero volume
    });
    expect(hook.volume).toBe(0.3);

    await act(async () => {
      await hook.setVolume(1.7); // clamped
    });
    expect(hook.volume).toBe(1);
  });
});
