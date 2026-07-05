/**
 * The single UI-facing surface for Spotify Phase 2: it owns the auth lifecycle
 * (handling the OAuth callback on load, login/logout) and the Web Playback SDK
 * player (warmed on connect, activated in the play gesture, play/toggle, live
 * state, volume, errors). The rest of the UI stays declarative — it reads
 * `status`/`current`/`error` and calls `login`/`play`/`toggle`/`logout` without
 * touching the API layer directly.
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
  /** Local device volume, 0..1. */
  volume: number;
  login(): void;
  logout(): void;
  /** Play a `spotify:track:` URI in-browser; inits the SDK on first call. */
  play(uri: string): Promise<void>;
  toggle(): Promise<void>;
  /** Seek to an absolute position (ms) in the current track. */
  seek(positionMs: number): Promise<void>;
  /** Set the local device volume (0..1). */
  setVolume(volume: number): Promise<void>;
  /** Mute, or restore the last non-zero volume. */
  toggleMute(): Promise<void>;
}

/**
 * Does this SDK state belong to the track we asked for? Spotify track-relinking
 * routinely plays a market-specific *substitute* whose `uri` differs from the
 * requested one — `linked_from` then carries the uri we actually requested.
 * Matching only `current_track.uri` made relinked plays look like "the player
 * never changed track".
 */
function stateMatchesUri(s: Spotify.PlaybackState, uri: string): boolean {
  const t = s.track_window.current_track;
  return t.uri === uri || t.linked_from?.uri === uri;
}

export function useSpotify(): SpotifyHook {
  const [status, setStatus] = useState<SpotifyStatus>('anonymous');
  const [error, setError] = useState<string | null>(null);
  const [premiumRequired, setPremiumRequired] = useState(false);
  const [current, setCurrent] = useState<Spotify.PlaybackState | null>(null);
  const [position, setPosition] = useState(0);
  const [volume, setVolumeState] = useState(0.8);

  const controllerRef = useRef<PlayerController | null>(null);
  const initRef = useRef<Promise<PlayerController> | null>(null);
  // True once the user has actually tapped "Play here". The player is warmed up
  // eagerly on connect, so we suppress its (possibly fatal, e.g. non-Premium)
  // errors until then — otherwise a banner would appear before any play attempt.
  const attemptedPlayRef = useRef(false);
  // Anchor for advancing `position` locally between the (sparse) SDK state events.
  const anchorRef = useRef({ pos: 0, at: 0, paused: true, dur: 0 });
  // Last non-zero volume, restored on unmute.
  const lastVolumeRef = useRef(0.8);
  // When the user last seeked locally. Right after a seek the SDK briefly still
  // reports the *pre-seek* position; without a grace window the reconcile loop
  // read that as ">2s divergence" and snapped the scrubber back.
  const lastSeekAtRef = useRef(0);

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
          if (type === 'account_error') setPremiumRequired(true);
          // Stay quiet during warm-up; only show a banner once the user has tried
          // to play, so warming on connect can't surface a premature error.
          if (attemptedPlayRef.current) setError(message);
        },
      });
    }
    const controller = await initRef.current;
    controllerRef.current = controller;
    // Sync the volume UI with whatever the device actually starts at.
    void controller
      .getVolume()
      .then((v) => {
        setVolumeState(v);
        if (v > 0) lastVolumeRef.current = v;
      })
      .catch(() => {});
    return controller;
  }, [applyState]);

  // Warm the SDK player as soon as the session is connected so the first
  // "Play here" tap is instant (the device is already registered and `ready`)
  // instead of paying for SDK load + connect at tap time.
  useEffect(() => {
    if (status !== 'connected' || SPOTIFY_CLIENT_ID === '') return;
    // Errors here are intentionally swallowed; they re-surface via onError once
    // the user taps play (see attemptedPlayRef).
    void ensurePlayer().catch(() => {});
  }, [status, ensurePlayer]);

  const play = useCallback(
    async (uri: string): Promise<void> => {
      attemptedPlayRef.current = true;
      setError(null);
      try {
        const controller = await ensurePlayer();
        // Mobile browsers gate audio behind a user gesture; activate the SDK's
        // audio element within this tap so the first play starts promptly rather
        // than being blocked/delayed. Best-effort: a no-op/rejection on desktop
        // must not abort playback.
        await controller.activateElement().catch(() => {});
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
        // Seed the player bar with the state for the *requested* track. Breaking
        // on the first truthy state is not enough: on every play after the first,
        // the device immediately reports the still-playing previous track, and the
        // SDK's `player_state_changed` is unreliable for API-initiated changes —
        // together those froze the bar on the old track while the audio moved on.
        // So poll until the state shows this uri, falling back to the freshest
        // state seen (the reconcile loop below converges any remainder).
        let freshest: Spotify.PlaybackState | null = null;
        for (let i = 0; i < 8; i++) {
          const s = await controller.getCurrentState();
          if (s) {
            freshest = s;
            if (stateMatchesUri(s, uri)) break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        if (freshest) applyState(freshest);
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
    lastSeekAtRef.current = Date.now();
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

  // Reconcile loop: `player_state_changed` is not reliably delivered for
  // API-initiated track changes, so while a track is loaded, poll the (local,
  // cheap) SDK state once a second and reconcile whenever what's playing
  // diverges from what's shown — track change, pause/resume from another
  // device, or an external seek. Otherwise just re-anchor the position clock
  // to SDK truth so local extrapolation never drifts.
  useEffect(() => {
    if (!current) return;
    const id = setInterval(() => {
      void controllerRef.current?.getCurrentState().then((s) => {
        if (!s) return;
        const a = anchorRef.current;
        const expectedPos = a.paused ? a.pos : a.pos + (Date.now() - a.at);
        // A local seek needs a grace window: the SDK reports the pre-seek
        // position for a beat, and re-applying that would yank the scrubber back.
        const seekSettling = Date.now() - lastSeekAtRef.current < 2_500;
        const diverged =
          s.track_window.current_track.uri !== current.track_window.current_track.uri ||
          s.paused !== current.paused ||
          (!seekSettling && Math.abs(s.position - expectedPos) > 2_000);
        if (diverged) {
          applyState(s);
        } else if (!seekSettling) {
          anchorRef.current = { pos: s.position, at: Date.now(), paused: s.paused, dur: s.duration };
        }
      });
    }, 1_000);
    return () => clearInterval(id);
  }, [current, applyState]);

  const setVolume = useCallback(async (v: number): Promise<void> => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    if (clamped > 0) lastVolumeRef.current = clamped;
    await controllerRef.current?.setVolume(clamped);
  }, []);

  const toggleMute = useCallback(async (): Promise<void> => {
    await setVolume(volume > 0 ? 0 : lastVolumeRef.current);
  }, [volume, setVolume]);

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
    volume,
    login,
    logout,
    play,
    toggle,
    seek,
    setVolume,
    toggleMute,
  };
}
