/**
 * The single UI-facing surface for Spotify Phase 2: it owns the auth lifecycle
 * (handling the OAuth callback on load, login/logout) and the Web Playback SDK
 * player (lazy init on first play, play/toggle, live state, errors). The rest of
 * the UI stays declarative — it reads `status`/`current`/`error` and calls
 * `login`/`play`/`toggle`/`logout` without touching the API layer directly.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  AuthError,
  beginLogin,
  completeLoginFromRedirect,
  isLoggedIn,
  logout as authLogout,
} from '../api/auth.js';
import { SPOTIFY_CLIENT_ID } from '../api/config.js';
import { initPlayer, type PlayerController } from '../api/playback.js';
import { playTracks, SpotifyApiError } from '../api/spotify.js';

export type SpotifyStatus = 'anonymous' | 'connected';

export interface SpotifyHook {
  /** A Client ID is configured — in-browser playback is even possible. */
  configured: boolean;
  status: SpotifyStatus;
  error: string | null;
  /** True once a fatal `account_error` reveals the account isn't Premium. */
  premiumRequired: boolean;
  /** Live SDK playback state (current track, paused, position), or null. */
  current: Spotify.PlaybackState | null;
  /** Live playback position (ms), advanced locally between SDK state events. */
  position: number;
  login(): void;
  logout(): void;
  /** Play a `spotify:track:` URI in-browser; inits the SDK on first call. */
  play(uri: string): Promise<void>;
  toggle(): Promise<void>;
  /** Seek to an absolute position (ms) in the current track. */
  seek(positionMs: number): Promise<void>;
}

export function useSpotify(): SpotifyHook {
  const [status, setStatus] = useState<SpotifyStatus>('anonymous');
  const [error, setError] = useState<string | null>(null);
  const [premiumRequired, setPremiumRequired] = useState(false);
  const [current, setCurrent] = useState<Spotify.PlaybackState | null>(null);
  const [position, setPosition] = useState(0);

  const controllerRef = useRef<PlayerController | null>(null);
  const initRef = useRef<Promise<PlayerController> | null>(null);
  // Anchor for advancing `position` locally between the (sparse) SDK state events.
  const anchorRef = useRef({ pos: 0, at: 0, paused: true, dur: 0 });

  // Push a fresh SDK state into the UI and re-anchor the local position clock.
  const applyState = useCallback((s: Spotify.PlaybackState | null): void => {
    setCurrent(s);
    if (s) {
      anchorRef.current = { pos: s.position, at: Date.now(), paused: s.paused, dur: s.duration };
      setPosition(s.position);
    }
  }, []);

  // On load: complete an OAuth callback if present, then settle the status.
  useEffect(() => {
    let cancelled = false;
    completeLoginFromRedirect()
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof AuthError ? e.message : 'Could not complete Spotify login.');
        }
      })
      .finally(() => {
        if (!cancelled) setStatus(isLoggedIn() ? 'connected' : 'anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazily create the SDK player (first call happens inside a user gesture, which
  // the browser autoplay policy requires for the first play).
  const ensurePlayer = useCallback(async (): Promise<PlayerController> => {
    if (controllerRef.current) return controllerRef.current;
    if (!initRef.current) {
      initRef.current = initPlayer({
        onStateChange: applyState,
        onError: (type, message) => {
          setError(message);
          if (type === 'account_error') setPremiumRequired(true);
        },
      });
    }
    const controller = await initRef.current;
    controllerRef.current = controller;
    return controller;
  }, [applyState]);

  const play = useCallback(
    async (uri: string): Promise<void> => {
      setError(null);
      try {
        const controller = await ensurePlayer();
        try {
          await playTracks(controller.deviceId, [uri]);
        } catch (e) {
          // The device can briefly 404 right after `ready` while Spotify registers
          // it; one short retry covers that race.
          if (e instanceof SpotifyApiError && e.status === 404) {
            await new Promise((r) => setTimeout(r, 500));
            await playTracks(controller.deviceId, [uri]);
          } else {
            throw e;
          }
        }
        // The `player_state_changed` event normally drives the player bar, but the
        // first event can be missed while the device spins up — seed from
        // getCurrentState so the controls reliably appear regardless.
        for (let i = 0; i < 5; i++) {
          const s = await controller.getCurrentState();
          if (s) {
            applyState(s);
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Playback failed.');
      }
    },
    [ensurePlayer, applyState],
  );

  const toggle = useCallback(async (): Promise<void> => {
    await controllerRef.current?.togglePlay();
  }, []);

  const seek = useCallback(async (positionMs: number): Promise<void> => {
    // Move the local clock immediately so the scrubber tracks the drag, then
    // ask the SDK to seek (a cheap, local operation on the in-tab player).
    anchorRef.current = { ...anchorRef.current, pos: positionMs, at: Date.now() };
    setPosition(positionMs);
    await controllerRef.current?.seek(positionMs);
  }, []);

  // Advance the displayed position while playing, between SDK state events.
  useEffect(() => {
    if (!current || current.paused) return;
    const id = setInterval(() => {
      const a = anchorRef.current;
      setPosition(Math.min(a.dur, a.pos + (Date.now() - a.at)));
    }, 500);
    return () => clearInterval(id);
  }, [current]);

  const login = useCallback((): void => {
    setError(null);
    beginLogin().catch((e) =>
      setError(e instanceof Error ? e.message : 'Could not start Spotify login.'),
    );
  }, []);

  const logout = useCallback((): void => {
    controllerRef.current?.disconnect();
    controllerRef.current = null;
    initRef.current = null;
    authLogout();
    setCurrent(null);
    setPosition(0);
    setPremiumRequired(false);
    setStatus('anonymous');
  }, []);

  return {
    configured: SPOTIFY_CLIENT_ID !== '',
    status,
    error,
    premiumRequired,
    current,
    position,
    login,
    logout,
    play,
    toggle,
    seek,
  };
}
