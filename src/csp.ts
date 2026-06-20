/**
 * Content-Security-Policy (VULN-005). GitHub Pages cannot set HTTP headers, so the
 * policy ships as a <meta> tag (`vite.config.ts` injects it into the production
 * HTML only). With Phase 2 the PKCE refresh token lives in localStorage, so this
 * policy is the load-bearing barrier between a future XSS and token theft. Each
 * directive is scoped to exactly what the Spotify flow needs:
 *   connect-src      api + accounts (token exchange) + *.spotify.com / wss (SDK + Widevine)
 *   script-src       self + the Web Playback SDK loader (sdk.scdn.co)
 *   img-src          self + Spotify CDN artwork (scdn.co), data: for inlined icons
 *   frame-src        the SDK's hidden iframe (sdk.scdn.co)
 *   media-src        self + Spotify media + blob: for the EME-decrypted stream
 *   frame-ancestors  'none' — VULN-011: this directive has no fallback to
 *                    default-src, so it must be set explicitly or the app can be
 *                    framed (clickjacking on "remove data" / "disconnect").
 *
 * Kept in its own dependency-free module (rather than inline in `vite.config.ts`)
 * so it can be unit-tested without pulling in the Vite/plugin toolchain.
 */
export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "connect-src 'self' https://api.spotify.com https://accounts.spotify.com https://*.spotify.com wss://*.spotify.com",
  "script-src 'self' https://sdk.scdn.co",
  "img-src 'self' data: https://i.scdn.co https://*.scdn.co",
  'frame-src https://sdk.scdn.co',
  "media-src 'self' https://*.spotify.com blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
] as const;

export const CSP = CSP_DIRECTIVES.join('; ');
