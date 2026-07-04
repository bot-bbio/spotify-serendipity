/**
 * Thin, typed Spotify Web API client: enrichment (artist artwork + genres,
 * track album art), player control (transfer / play / pause / queue on the Web
 * Playback SDK device), playlists (Time Capsules: create / fill / cover), the
 * consolidated library (♥ save), and the user's live top items (Then vs Now).
 *
 * Every endpoint here is the current, non-deprecated variant from the official
 * OpenAPI schema — notably `POST /me/playlists` (not the deprecated
 * `/users/{id}/playlists`), `/playlists/{id}/items` (not `/tracks`), and the
 * consolidated `/me/library` (not the type-specific `/me/tracks`).
 *
 * Resilience per CLAUDE.md:
 * - **429 / 5xx** → retry with `retryDelayMs` backoff that honors the server's
 *   `Retry-After` header (no tight retry loops).
 * - **401** → refresh the token once and retry, so a silently-expired access
 *   token self-heals instead of surfacing as an error.
 */

import { getValidAccessToken, invalidateAccessToken } from './auth.js';
import { API_BASE } from './config.js';

/** Maximum automatic retries for transient failures (429 / 5xx). */
const MAX_RETRIES = 4;

/** A Spotify Web API error carrying the HTTP status so callers can branch on it. */
export class SpotifyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

// ---- response shapes (minimal subsets we actually consume) ----------------

export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface ArtistInfo {
  id: string;
  name: string;
  genres: string[];
  images: SpotifyImage[];
}

export interface TrackInfo {
  id: string;
  name: string;
  album: { name: string; images: SpotifyImage[] };
  artists: { id: string; name: string }[];
}

/**
 * Backoff delay (ms) before retry `attempt` (0-based). Honors a numeric
 * `Retry-After` header when present (capped), otherwise capped exponential
 * backoff. Pure and deterministic so it is unit-testable; the caller schedules
 * the timer.
 */
export function retryDelayMs(
  attempt: number,
  retryAfter: string | null,
  baseMs = 500,
  capMs = 20_000,
): number {
  if (retryAfter !== null) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, capMs);
  }
  return Math.min(baseMs * 2 ** attempt, capMs);
}

/** Extract the bare id from a `spotify:track:<id>` URI, or `null` if it isn't one. */
export function parseTrackUri(uri: string): string | null {
  const m = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri);
  return m ? m[1] : null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Request body: JSON (serialized + content-typed) or raw (pre-encoded, e.g. a base64 JPEG). */
interface SendBody {
  json?: unknown;
  raw?: { content: string; contentType: string };
}

/** Authenticated GET returning parsed JSON of type `T`. */
export function apiGet<T>(path: string): Promise<T> {
  return send<T>('GET', path);
}

async function send<T>(method: string, path: string, body?: SendBody, attempt = 0): Promise<T> {
  const token = await getValidAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const init: RequestInit = { method, headers };
  if (body?.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body.json);
  } else if (body?.raw !== undefined) {
    headers['Content-Type'] = body.raw.contentType;
    init.body = body.raw.content;
  }

  const res = await fetch(API_BASE + path, init);

  // A stale access token: drop it and retry once with a freshly refreshed one.
  if (res.status === 401 && attempt === 0) {
    invalidateAccessToken();
    return send<T>(method, path, body, attempt + 1);
  }
  // Rate limited or transient server error: back off and retry.
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
    await sleep(retryDelayMs(attempt, res.headers.get('Retry-After')));
    return send<T>(method, path, body, attempt + 1);
  }
  if (!res.ok) throw new SpotifyApiError(res.status, await errorMessage(res));
  // Several write endpoints reply 204/202 or an empty 200/201 body.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text === '' ? undefined : JSON.parse(text)) as T;
}

/**
 * True when the error is Spotify's 403 "insufficient client scope" — the
 * session predates a scope this feature needs, and the fix is a fresh consent
 * (reconnect), not a retry.
 */
export function isInsufficientScope(e: unknown): boolean {
  return e instanceof SpotifyApiError && e.status === 403 && /scope/i.test(e.message);
}

async function errorMessage(res: Response): Promise<string> {
  const detail = (await res.json().catch(() => null)) as {
    error?: { message?: unknown };
  } | null;
  const msg = detail?.error?.message;
  return typeof msg === 'string' ? msg : `${res.status} ${res.statusText}`;
}

// ---- enrichment -----------------------------------------------------------

/** Artist artwork + genres for the result card. */
export function getArtist(id: string): Promise<ArtistInfo> {
  return apiGet<ArtistInfo>(`/artists/${encodeURIComponent(id)}`);
}

/** Batch artist lookup (Spotify allows up to 50 ids per call). */
export async function getArtists(ids: string[]): Promise<ArtistInfo[]> {
  if (ids.length === 0) return [];
  const list = ids.map(encodeURIComponent).join(',');
  const res = await apiGet<{ artists: ArtistInfo[] }>(`/artists?ids=${list}`);
  return res.artists;
}

/** Track + album art for the result card. */
export function getTrack(id: string): Promise<TrackInfo> {
  return apiGet<TrackInfo>(`/tracks/${encodeURIComponent(id)}`);
}

// ---- player control (Web Playback SDK device) -----------------------------

/** Move playback to `deviceId` (the SDK player), optionally starting it. */
export function transferPlayback(deviceId: string, play = false): Promise<void> {
  return send<void>('PUT', '/me/player', { json: { device_ids: [deviceId], play } });
}

/** Start playback of the given track URIs on `deviceId`. */
export function playTracks(deviceId: string, uris: string[]): Promise<void> {
  return send<void>('PUT', `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    json: { uris },
  });
}

export function pausePlayback(deviceId: string): Promise<void> {
  return send<void>('PUT', `/me/player/pause?device_id=${encodeURIComponent(deviceId)}`);
}

/**
 * Queue a track after the current one. Targets the active device when
 * `deviceId` is omitted (there is one whenever the player bar is showing).
 */
export function addToQueue(uri: string, deviceId?: string): Promise<void> {
  const params = new URLSearchParams({ uri });
  if (deviceId) params.set('device_id', deviceId);
  return send<void>('POST', `/me/player/queue?${params.toString()}`);
}

// ---- playlists (Time Capsules) ---------------------------------------------

export interface CreatedPlaylist {
  id: string;
  external_urls: { spotify: string };
}

/** Create a private playlist on the current user's account (POST /me/playlists). */
export function createPlaylist(name: string, description: string): Promise<CreatedPlaylist> {
  return send<CreatedPlaylist>('POST', '/me/playlists', {
    json: { name, description, public: false },
  });
}

/** Add up to 100 track URIs to a playlist in one request. */
export function addPlaylistItems(playlistId: string, uris: string[]): Promise<void> {
  if (uris.length === 0) return Promise.resolve();
  if (uris.length > 100) throw new RangeError('Spotify accepts at most 100 items per request.');
  return send<void>('POST', `/playlists/${encodeURIComponent(playlistId)}/items`, {
    json: { uris },
  });
}

/** Upload a custom cover (base64 JPEG, no data: prefix, ≤256 KB). Replies 202. */
export function uploadPlaylistCover(playlistId: string, base64Jpeg: string): Promise<void> {
  return send<void>('PUT', `/playlists/${encodeURIComponent(playlistId)}/images`, {
    raw: { content: base64Jpeg, contentType: 'image/jpeg' },
  });
}

// ---- library (♥ save) — the consolidated endpoints per CLAUDE.md -----------

const uriList = (uris: string[]): string => {
  if (uris.length === 0 || uris.length > 40) {
    throw new RangeError('The library endpoints accept 1–40 URIs per request.');
  }
  return new URLSearchParams({ uris: uris.join(',') }).toString();
};

/** Which of the given URIs are already in the user's library (order-aligned). */
export function checkLibraryContains(uris: string[]): Promise<boolean[]> {
  return apiGet<boolean[]>(`/me/library/contains?${uriList(uris)}`);
}

export function saveToLibrary(uris: string[]): Promise<void> {
  return send<void>('PUT', `/me/library?${uriList(uris)}`);
}

export function removeFromLibrary(uris: string[]): Promise<void> {
  return send<void>('DELETE', `/me/library?${uriList(uris)}`);
}

// ---- top items (Then vs Now) -----------------------------------------------

export type TopTimeRange = 'short_term' | 'medium_term' | 'long_term';

export interface TopArtist {
  id: string;
  name: string;
  images: SpotifyImage[];
  external_urls: { spotify: string };
}

/** The user's live top artists over the given affinity window. */
export async function getTopArtists(timeRange: TopTimeRange, limit = 50): Promise<TopArtist[]> {
  const params = new URLSearchParams({ time_range: timeRange, limit: String(limit) });
  const res = await apiGet<{ items: TopArtist[] }>(`/me/top/artists?${params.toString()}`);
  return res.items;
}
