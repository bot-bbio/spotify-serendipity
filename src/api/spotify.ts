/**
 * Thin, typed Spotify Web API client for Phase 2: enrichment (artist artwork +
 * genres, track album art) and player control (transfer / play / pause on the
 * Web Playback SDK device).
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

/** Authenticated GET returning parsed JSON of type `T`. */
export function apiGet<T>(path: string): Promise<T> {
  return send<T>('GET', path);
}

async function send<T>(
  method: string,
  path: string,
  jsonBody?: unknown,
  attempt = 0,
): Promise<T> {
  const token = await getValidAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const init: RequestInit = { method, headers };
  if (jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(jsonBody);
  }

  const res = await fetch(API_BASE + path, init);

  // A stale access token: drop it and retry once with a freshly refreshed one.
  if (res.status === 401 && attempt === 0) {
    invalidateAccessToken();
    return send<T>(method, path, jsonBody, attempt + 1);
  }
  // Rate limited or transient server error: back off and retry.
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
    await sleep(retryDelayMs(attempt, res.headers.get('Retry-After')));
    return send<T>(method, path, jsonBody, attempt + 1);
  }
  if (!res.ok) throw new SpotifyApiError(res.status, await errorMessage(res));
  if (res.status === 204) return undefined as T; // player endpoints reply 204 No Content
  return (await res.json()) as T;
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
  return send<void>('PUT', '/me/player', { device_ids: [deviceId], play });
}

/** Start playback of the given track URIs on `deviceId`. */
export function playTracks(deviceId: string, uris: string[]): Promise<void> {
  return send<void>('PUT', `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { uris });
}

export function pausePlayback(deviceId: string): Promise<void> {
  return send<void>('PUT', `/me/player/pause?device_id=${encodeURIComponent(deviceId)}`);
}
