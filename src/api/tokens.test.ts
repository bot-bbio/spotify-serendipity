import { beforeEach, describe, expect, it } from 'vitest';
import { clearAccessToken, getAccessToken, isExpired, setAccessToken } from './tokens.js';

describe('access-token expiry', () => {
  beforeEach(() => clearAccessToken());

  it('treats a token as expired once inside the skew window', () => {
    const expiresAt = 1_000_000;
    expect(isExpired(expiresAt, expiresAt - 60_000, 30_000)).toBe(false); // 60s out: still valid
    expect(isExpired(expiresAt, expiresAt - 10_000, 30_000)).toBe(true); // 10s out: inside skew
    expect(isExpired(expiresAt, expiresAt + 1, 30_000)).toBe(true); // past deadline
  });

  it('returns the access token while it is valid', () => {
    setAccessToken('tok', 3600);
    expect(getAccessToken()).toBe('tok');
  });

  it('hides the token once expired', () => {
    setAccessToken('tok', 3600);
    const afterExpiry = Date.now() + 3600 * 1000 + 1;
    expect(getAccessToken(afterExpiry)).toBeNull();
  });

  it('clears the token', () => {
    setAccessToken('tok', 3600);
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });
});
