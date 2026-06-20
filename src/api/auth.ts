/**
 * Authorization Code + PKCE orchestration: begin login, complete the redirect
 * callback, and hand out a valid access token (refreshing silently as needed).
 *
 * Security invariants (VULN-007):
 * - `state` and `code_verifier` come from `pkce.ts` (cryptographic randomness).
 * - `state` is validated on callback before the code is exchanged (CSRF defense).
 * - The `code_verifier` is held transiently in `sessionStorage` and cleared the
 *   moment the callback is handled.
 * - The access token lives only in memory (`tokens.ts`); only the refresh token
 *   is persisted.
 */

import {
  AUTH_ENDPOINT,
  redirectUri,
  requireClientId,
  SCOPES,
  TOKEN_ENDPOINT,
} from './config.js';
import { createCodeVerifier, deriveCodeChallenge, randomUrlToken } from './pkce.js';
import {
  clearAccessToken,
  clearRefreshToken,
  getAccessToken,
  loadRefreshToken,
  saveRefreshToken,
  setAccessToken,
} from './tokens.js';

/** Transient PKCE/state stash, cleared on callback. */
const VERIFIER_KEY = 'serendipity.pkce.verifier';
const STATE_KEY = 'serendipity.auth.state';

/** Auth-flow failures surfaced to the UI (state mismatch, token errors, etc.). */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Start the flow: generate a cryptographic verifier, challenge, and `state`;
 * stash the verifier + state in `sessionStorage`; and navigate to Spotify's
 * consent screen. The returned promise normally never resolves (the page
 * redirects away) — it only matters if it throws before the redirect.
 */
export async function beginLogin(): Promise<void> {
  const clientId = requireClientId();
  const verifier = createCodeVerifier();
  const challenge = await deriveCodeChallenge(verifier);
  const state = randomUrlToken(16);

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SCOPES.join(' '),
  });
  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`);
}

/**
 * If the current URL is an OAuth callback (`?code` or `?error`), complete login:
 * validate `state` against the stashed value (CSRF defense), exchange the code
 * for tokens, and persist the refresh token. Always strips the auth params from
 * the URL afterwards so a reload can't replay the code or leak it via history.
 * Returns `true` if a callback was handled, `false` if this isn't a callback.
 */
export async function completeLoginFromRedirect(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return false;

  // Read then immediately clear the transient stash, regardless of outcome.
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  stripAuthParams(url);

  if (error) throw new AuthError(`Spotify authorization was denied (${error}).`);
  if (!returnedState || returnedState !== expectedState) {
    throw new AuthError('Authorization state did not match — login aborted to prevent CSRF.');
  }
  if (!verifier) throw new AuthError('Missing PKCE verifier — please start login again.');

  await exchangeCode(code as string, verifier);
  return true;
}

/** Whether a session can be (re)established without a fresh redirect. */
export function isLoggedIn(): boolean {
  return getAccessToken() !== null || loadRefreshToken() !== null;
}

/**
 * A valid access token, refreshing silently if the in-memory one is missing or
 * expired and a refresh token is available. Throws `AuthError` when the user
 * must log in again.
 */
export async function getValidAccessToken(): Promise<string> {
  const current = getAccessToken();
  if (current) return current;
  const refresh = loadRefreshToken();
  if (!refresh) throw new AuthError('Not logged in to Spotify.');
  return refreshAccessToken(refresh);
}

/** Discard the in-memory access token, forcing the next call to refresh (e.g. after a 401). */
export function invalidateAccessToken(): void {
  clearAccessToken();
}

export function logout(): void {
  clearAccessToken();
  clearRefreshToken();
}

async function exchangeCode(code: string, verifier: string): Promise<void> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: requireClientId(),
    code_verifier: verifier,
  });
  applyTokens(await postToken(body));
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: requireClientId(),
  });
  let tokens: TokenResponse;
  try {
    tokens = await postToken(body);
  } catch (e) {
    // A rejected refresh token (revoked / expired) means the session is dead.
    logout();
    throw e instanceof AuthError ? e : new AuthError('Session expired — please log in again.');
  }
  applyTokens(tokens);
  return tokens.access_token;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    // Spotify returns { error, error_description }; surface the description only.
    const detail = (await res.json().catch(() => null)) as { error_description?: unknown } | null;
    const desc =
      typeof detail?.error_description === 'string' ? detail.error_description : res.statusText;
    throw new AuthError(`Token request failed (${res.status}): ${desc}`);
  }
  return res.json() as Promise<TokenResponse>;
}

function applyTokens(tokens: TokenResponse): void {
  setAccessToken(tokens.access_token, tokens.expires_in);
  // Spotify may rotate the refresh token on refresh; persist it whenever present.
  if (tokens.refresh_token) saveRefreshToken(tokens.refresh_token);
}

/** Remove the OAuth query params from the address bar without a navigation. */
function stripAuthParams(url: URL): void {
  for (const key of ['code', 'state', 'error']) url.searchParams.delete(key);
  const clean = url.pathname + url.search + url.hash;
  window.history.replaceState({}, document.title, clean);
}
