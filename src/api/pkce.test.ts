import { describe, expect, it } from 'vitest';
import { createCodeVerifier, deriveCodeChallenge, randomUrlToken } from './pkce.js';

describe('PKCE primitives (VULN-007: cryptographic randomness)', () => {
  it('derives the RFC 7636 S256 challenge for the spec test vector', async () => {
    // RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await deriveCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('emits base64url tokens with no padding or non-url characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomUrlToken()).toMatch(/^[A-Za-z0-9\-_]+$/);
    }
  });

  it('generates a verifier inside the RFC length range (43–128)', () => {
    const v = createCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });

  it('does not repeat tokens (randomness sanity check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(randomUrlToken());
    expect(seen.size).toBe(1000);
  });
});
