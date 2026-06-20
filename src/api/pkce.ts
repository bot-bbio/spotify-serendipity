/**
 * PKCE (RFC 7636) + OAuth `state` primitives for the Authorization Code + PKCE
 * flow.
 *
 * Security-critical (VULN-007): every value here is generated from the
 * cryptographic `crypto.getRandomValues` / `crypto.subtle`, **never** the
 * `mulberry32` PRNG in `core/random.ts`. That PRNG is fine for "surprise me" but
 * predictable — a predictable `state` enables OAuth CSRF, and a predictable
 * `code_verifier` defeats the entire purpose of PKCE.
 */

/** URL-safe base64 (base64url) of raw bytes — no padding, per RFC 7636 §A. */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A cryptographically-random base64url token of `byteLength` random bytes. Used
 * for the OAuth `state` parameter (CSRF defense) and as the PKCE verifier.
 */
export function randomUrlToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/**
 * A PKCE `code_verifier`: 32 random bytes → base64url (~43 chars), comfortably
 * inside the RFC's 43–128 character range.
 */
export function createCodeVerifier(): string {
  return randomUrlToken(32);
}

/**
 * The PKCE `code_challenge` for a verifier using the S256 method:
 * `base64url(SHA-256(verifier))`.
 */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
