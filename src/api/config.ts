/**
 * Central Spotify Web API configuration — the single source of truth for the
 * client ID, OAuth/PKCE endpoints, requested scopes, and redirect URI. Kept
 * dependency-free so the auth flow, the REST layer, and the playback layer all
 * import the same constants.
 *
 * Per CLAUDE.md this app uses **Authorization Code + PKCE**, so there is no
 * client secret anywhere in the client — PKCE replaces it. The Client ID is a
 * public identifier and is injected from the build environment.
 */

/**
 * Public Spotify application Client ID, injected at build time from
 * `VITE_SPOTIFY_CLIENT_ID` (see `.env.example`). Empty until the user registers
 * an app and provides it; `requireClientId()` fails closed with a clear message
 * rather than firing a malformed authorization request.
 */
export const SPOTIFY_CLIENT_ID: string = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '';

/** OAuth 2.0 authorization endpoint (PKCE). */
export const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
/** OAuth 2.0 token endpoint (code exchange + refresh). */
export const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
/** Web API base URL. */
export const API_BASE = 'https://api.spotify.com/v1';
/** Web Playback SDK loader script. */
export const PLAYBACK_SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';

/**
 * Requested scopes — each maps to a shipped feature, nothing preemptive:
 * - `streaming`                    Web Playback SDK in-browser playback (Premium).
 * - `user-read-email` / `-private` required companions of `streaming`.
 * - `user-modify-playback-state`   start/stop playback + add-to-queue on the SDK device.
 * - `user-read-playback-state`     read the active device / player state.
 * - `playlist-modify-private`      Time Capsules: create the private playlist + name it.
 * - `ugc-image-upload`             Time Capsules: upload the generated cover art.
 * - `user-top-read`                Then vs Now: the user's live top artists.
 * - `user-library-read`            the ♥ button's "already saved?" check.
 * - `user-library-modify`          the ♥ button's save / remove.
 *
 * Note: a refresh token only carries the scopes it was minted with — sessions
 * created before a scope was added get 403 "insufficient scope" on the new
 * endpoints until the user reconnects (see `isInsufficientScope` in spotify.ts).
 */
export const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
  'playlist-modify-private',
  'ugc-image-upload',
  'user-top-read',
  'user-library-read',
  'user-library-modify',
] as const;

/**
 * The redirect URI for the OAuth round-trip, derived at runtime from the URL the
 * app is actually served from (origin + path, minus any trailing `index.html`).
 *
 * Deriving it keeps the value correct for both local dev (`http://127.0.0.1:5173/`)
 * and a GitHub Pages project path without hardcoding. It deliberately redirects
 * back to the app's own URL rather than a `/callback` route, because the deploy
 * target (GitHub Pages, relative `base`) has no SPA fallback to serve a sub-path —
 * the app detects the `?code` on load instead. The authorize request and the
 * token exchange both call this, so the two are always byte-identical (Spotify
 * requires an exact match).
 *
 * Whatever this returns is exactly what must be registered in the Spotify app
 * dashboard. VULN-009: use `127.0.0.1`, never `localhost`.
 */
export function redirectUri(): string {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/index\.html$/, '');
}

/** Returns the configured Client ID, or throws a clear, user-facing error. */
export function requireClientId(): string {
  if (!SPOTIFY_CLIENT_ID) {
    throw new Error(
      'Spotify Client ID is not configured. Set VITE_SPOTIFY_CLIENT_ID in a .env ' +
        'file (see .env.example) and rebuild.',
    );
  }
  return SPOTIFY_CLIENT_ID;
}
