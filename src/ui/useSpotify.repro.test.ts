// @vitest-environment happy-dom
//
// Regression for the two reported playback defects, driving the REAL useSpotify
// hook (not a mock):
//   1. "playback is delayed when pressing play"  -> the player must be warmed on
//      connect (so the first tap doesn't pay SDK-load + connect), and the audio
//      element must be activated inside the tap (mobile autoplay requirement).
//   2. "controls only show up after clicking to another group" -> play() must
//      seed `current` from the (now-warm, active) device promptly, and the SDK
//      state event must also drive it.

import { act, renderHook, waitFor } from '@testing-library/preact';
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

// Capture the handlers the hook passes to initPlayer so the test can fire the
// SDK's player_state_changed event the way the real SDK eventually would.
let captured: import('../api/playback.js').PlayerHandlers = {};
let currentState: Spotify.PlaybackState | null = null;
const getCurrentState = vi.fn(async () => currentState);
const activateElement = vi.fn(async () => {});
const initPlayer = vi.fn(async (handlers: import('../api/playback.js').PlayerHandlers) => {
  captured = handlers;
  handlers.onReady?.('device-123');
  return {
    deviceId: 'device-123',
    togglePlay: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    seek: vi.fn(),
    getCurrentState,
    activateElement,
    disconnect: vi.fn(),
  };
});

vi.mock('../api/playback.js', () => ({
  initPlayer: (handlers: import('../api/playback.js').PlayerHandlers) => initPlayer(handlers),
}));

const playTracks = vi.fn(async (_deviceId: string, _uris: string[]) => {});
vi.mock('../api/spotify.js', () => ({
  playTracks: (deviceId: string, uris: string[]) => playTracks(deviceId, uris),
  SpotifyApiError: class extends Error {
    constructor(public status: number, m: string) {
      super(m);
    }
  },
}));

vi.mock('../api/auth.js', () => ({
  AuthError: class extends Error {},
  beginLogin: vi.fn(),
  completeLoginFromRedirect: vi.fn().mockResolvedValue(false),
  isLoggedIn: vi.fn().mockReturnValue(true),
  logout: vi.fn(),
}));

// A configured client id so the hook treats playback as possible.
vi.mock('../api/config.js', () => ({ SPOTIFY_CLIENT_ID: 'test-client-id' }));

import { useSpotify } from './useSpotify.js';

function playingState(): Spotify.PlaybackState {
  return {
    paused: false,
    position: 0,
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
  } as unknown as Spotify.PlaybackState;
}

beforeEach(() => {
  mem.clear();
  captured = {};
  currentState = null;
  getCurrentState.mockClear();
  activateElement.mockClear();
  initPlayer.mockClear();
  playTracks.mockClear();
});

describe('useSpotify playback responsiveness', () => {
  it('warms the SDK player as soon as the session is connected', async () => {
    renderHook(() => useSpotify());
    // The player should be registered without waiting for a "Play here" tap.
    await waitFor(() => expect(initPlayer).toHaveBeenCalledTimes(1));
  });

  it('activates the audio element inside the play gesture and reuses the warm player', async () => {
    const { result } = renderHook(() => useSpotify());
    await waitFor(() => expect(result.current.status).toBe('connected'));
    await waitFor(() => expect(initPlayer).toHaveBeenCalledTimes(1)); // warmed

    currentState = playingState(); // warm, active device reports state immediately
    await act(async () => {
      await result.current.play('spotify:track:x');
    });

    expect(activateElement).toHaveBeenCalledTimes(1); // mobile autoplay unblock
    expect(playTracks).toHaveBeenCalledWith('device-123', ['spotify:track:x']);
    expect(initPlayer).toHaveBeenCalledTimes(1); // not re-created on play
    expect(result.current.current).not.toBeNull(); // controls available at once
  });

  it('still surfaces controls when the SDK state event arrives after the poll', async () => {
    const { result } = renderHook(() => useSpotify());
    await waitFor(() => expect(result.current.status).toBe('connected'));

    currentState = null; // cold: poll never sees state
    await act(async () => {
      await result.current.play('spotify:track:x');
    });
    act(() => captured.onStateChange?.(playingState())); // event eventually fires

    expect(result.current.current).not.toBeNull();
  });
});
