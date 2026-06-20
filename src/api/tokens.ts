/**
 * Token storage for the PKCE flow, split by lifetime and sensitivity:
 *
 * - **Access token** — short-lived bearer, kept only in module memory. It dies
 *   with the tab and is never written to disk, so an XSS would have to run while
 *   the tab is open to use it.
 * - **Refresh token** — long-lived, persisted in `localStorage` so a returning
 *   user is silently re-authenticated without another redirect (STRATEGY §8).
 *
 * Security note (same class as VULN-006): a refresh token in `localStorage` is a
 * persistent secret readable by any script on the origin, so a single XSS could
 * exfiltrate it. The Content-Security-Policy (VULN-005) is the load-bearing
 * mitigation; in-memory-only / `sessionStorage` is the stricter fallback if the
 * silent-resume convenience is later judged not worth the exposure.
 */

const REFRESH_KEY = 'serendipity.auth.refresh';
/** Refresh the access token this many ms *before* it actually expires. */
const EXPIRY_SKEW_MS = 30_000;

let accessToken: string | null = null;
let accessTokenExpiresAt = 0; // epoch ms

/**
 * Whether a token with the given absolute expiry should be treated as expired —
 * `true` once we are within `skewMs` of the deadline, so callers refresh a hair
 * early rather than racing a 401.
 */
export function isExpired(
  expiresAt: number,
  now: number = Date.now(),
  skewMs: number = EXPIRY_SKEW_MS,
): boolean {
  return now >= expiresAt - skewMs;
}

/** Store the access token and compute its absolute expiry from `expires_in` (seconds). */
export function setAccessToken(token: string, expiresInSec: number): void {
  accessToken = token;
  accessTokenExpiresAt = Date.now() + expiresInSec * 1000;
}

/** The in-memory access token if present and not (nearly) expired, else `null`. */
export function getAccessToken(now: number = Date.now()): string | null {
  if (!accessToken || isExpired(accessTokenExpiresAt, now)) return null;
  return accessToken;
}

export function clearAccessToken(): void {
  accessToken = null;
  accessTokenExpiresAt = 0;
}

// ---- refresh token (localStorage, best-effort) ----------------------------

/** Web Storage, or `null` when unavailable (storage disabled, or non-browser tests). */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveRefreshToken(token: string): void {
  store()?.setItem(REFRESH_KEY, token);
}

export function loadRefreshToken(): string | null {
  return store()?.getItem(REFRESH_KEY) ?? null;
}

export function clearRefreshToken(): void {
  store()?.removeItem(REFRESH_KEY);
}
