/**
 * Web Playback SDK lifecycle (STRATEGY §8): load the SDK once, create a player
 * that pulls a fresh OAuth token from the PKCE auth layer on demand, wire the
 * lifecycle events, and connect. Resolves with a small controller once the tab
 * is registered as a Spotify Connect device.
 *
 * Requires Spotify **Premium** — the SDK fires `account_error` for Free accounts.
 * First playback also needs a user gesture (browser autoplay policy), so callers
 * should kick off `initPlayer` from a click handler.
 */

import { getValidAccessToken } from './auth.js';
import { PLAYBACK_SDK_SRC } from './config.js';

export interface PlayerController {
  /** The Spotify Connect device id for this tab (available once `ready`). */
  readonly deviceId: string;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Seek to an absolute position (ms) within the current track. */
  seek(positionMs: number): Promise<void>;
  /** Snapshot of the player's current state, or null if the device is idle. */
  getCurrentState(): Promise<Spotify.PlaybackState | null>;
  /** Set the local device volume, 0..1. */
  setVolume(volume: number): Promise<void>;
  /** Current local device volume, 0..1. */
  getVolume(): Promise<number>;
  disconnect(): void;
}

export interface PlayerHandlers {
  onReady?(deviceId: string): void;
  onNotReady?(deviceId: string): void;
  onStateChange?(state: Spotify.PlaybackState | null): void;
  /** Fatal errors: authentication_error / account_error (non-Premium) / etc. */
  onError?(type: Spotify.ErrorType, message: string): void;
}

const ERROR_TYPES: readonly Spotify.ErrorType[] = [
  'initialization_error',
  'authentication_error',
  'account_error',
  'playback_error',
];

let sdkLoad: Promise<void> | null = null;

/**
 * Load the SDK script exactly once. The SDK calls the global
 * `window.onSpotifyWebPlaybackSDKReady` when it is ready; we resolve on that.
 */
function loadSdk(): Promise<void> {
  if (sdkLoad) return sdkLoad;
  sdkLoad = new Promise<void>((resolve, reject) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = PLAYBACK_SDK_SRC;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load the Spotify Web Playback SDK.'));
    document.head.appendChild(script);
  });
  return sdkLoad;
}

/**
 * Initialise the in-browser player and resolve with a controller once the device
 * is `ready`. Rejects if the SDK fails to load or the player fails to connect;
 * runtime errors (auth / account / playback) are reported via `handlers.onError`.
 */
export async function initPlayer(
  handlers: PlayerHandlers = {},
  name = 'Serendipity',
): Promise<PlayerController> {
  await loadSdk();

  const player = new window.Spotify.Player({
    name,
    getOAuthToken: (cb) => {
      // Called on connect and on every silent re-auth the SDK performs.
      void getValidAccessToken()
        .then(cb)
        .catch(() =>
          handlers.onError?.('authentication_error', 'Could not obtain a Spotify access token.'),
        );
    },
    volume: 0.8,
  });

  player.addListener('player_state_changed', (state) => handlers.onStateChange?.(state));
  player.addListener('not_ready', ({ device_id }) => handlers.onNotReady?.(device_id));
  for (const type of ERROR_TYPES) {
    player.addListener(type, ({ message }) => handlers.onError?.(type, message));
  }

  return new Promise<PlayerController>((resolve, reject) => {
    player.addListener('ready', ({ device_id }) => {
      handlers.onReady?.(device_id);
      resolve({
        deviceId: device_id,
        togglePlay: () => player.togglePlay(),
        pause: () => player.pause(),
        resume: () => player.resume(),
        seek: (positionMs) => player.seek(positionMs),
        getCurrentState: () => player.getCurrentState(),
        setVolume: (volume) => player.setVolume(volume),
        getVolume: () => player.getVolume(),
        disconnect: () => player.disconnect(),
      });
    });
    player.connect().then(
      (ok) => {
        if (!ok) reject(new Error('The Spotify player failed to connect.'));
      },
      reject,
    );
  });
}
