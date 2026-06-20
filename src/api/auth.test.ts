import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken } from './tokens.js';

// auth.ts needs a configured client id to build the token-refresh request body;
// stub just that export so the test doesn't depend on a real .env value.
vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js');
  return { ...actual, requireClientId: () => 'test-client-id' };
});

// Static (not dynamic-per-test) import: dynamic re-import after vi.resetModules()
// would give auth.ts a fresh, *separate* copy of tokens.ts from the one this file
// imports directly, decoupling clearAccessToken() here from the state auth.ts
// actually reads/writes.
const { getValidAccessToken } = await import('./auth.js');

describe('getValidAccessToken concurrency (VULN-012: shared in-flight refresh)', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = { 'serendipity.auth.refresh': 'refresh-token-abc' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    clearAccessToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('serves two racing callers from a single token request instead of spending the refresh token twice', async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        return new Response(
          JSON.stringify({ access_token: 'fresh-token', token_type: 'Bearer', expires_in: 3600 }),
          { status: 200 },
        );
      }),
    );

    // Both calls race while the in-memory access token is absent — without the
    // VULN-012 fix, each would independently spend the same refresh token.
    const [a, b] = await Promise.all([getValidAccessToken(), getValidAccessToken()]);

    expect(a).toBe('fresh-token');
    expect(b).toBe('fresh-token');
    expect(fetchCalls).toBe(1);
  });

  it('issues a fresh request on the next expiry once the shared refresh has settled', async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls++;
        return new Response(
          JSON.stringify({ access_token: `token-${fetchCalls}`, token_type: 'Bearer', expires_in: 3600 }),
          { status: 200 },
        );
      }),
    );

    const first = await getValidAccessToken();
    expect(first).toBe('token-1');
    expect(fetchCalls).toBe(1);

    // Force expiry of the in-memory token; the shared promise must have been
    // cleared after settling, so this triggers a genuinely new request.
    clearAccessToken();
    const second = await getValidAccessToken();
    expect(second).toBe('token-2');
    expect(fetchCalls).toBe(2);
  });
});
