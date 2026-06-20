import preact from '@preact/preset-vite';
import { type Plugin, defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Content-Security-Policy (VULN-005). GitHub Pages cannot set HTTP headers, so the
// policy ships as a <meta> tag. With Phase 2 the PKCE refresh token lives in
// localStorage, so this policy is the load-bearing barrier between a future XSS and
// token theft. Each directive is scoped to exactly what the Spotify flow needs:
//   connect-src  api + accounts (token exchange) + *.spotify.com / wss (SDK + Widevine)
//   script-src   self + the Web Playback SDK loader (sdk.scdn.co)
//   img-src      self + Spotify CDN artwork (scdn.co), data: for inlined icons
//   frame-src    the SDK's hidden iframe (sdk.scdn.co)
//   media-src    self + Spotify media + blob: for the EME-decrypted stream
const CSP = [
  "default-src 'self'",
  "connect-src 'self' https://api.spotify.com https://accounts.spotify.com https://*.spotify.com wss://*.spotify.com",
  "script-src 'self' https://sdk.scdn.co",
  "img-src 'self' data: https://i.scdn.co https://*.scdn.co",
  'frame-src https://sdk.scdn.co',
  "media-src 'self' https://*.spotify.com blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

// Inject the CSP meta into the production HTML only. The dev server relies on inline
// scripts (the Preact refresh preamble, HMR client) that a strict policy would block,
// so applying it in dev would break `vite dev` without protecting anything shipped.
function cspMeta(): Plugin {
  return {
    name: 'inject-csp-meta',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (ctx.server) return; // dev server: skip (no-op)
        // Prepend so the policy governs every resource fetched after it.
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

// Static, client-only PWA. `base` is relative so it can be served from a GitHub
// Pages project path without rewriting asset URLs.
export default defineConfig({
  base: './',
  // Bind dev to 127.0.0.1:5173 so it matches the registered OAuth redirect URI
  // exactly (VULN-009: Spotify requires 127.0.0.1, never localhost).
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  plugins: [
    // prefresh (component-level Fast Refresh) is disabled: it was observed to
    // double-mount the app root into #app in some browsers when a long-open dev
    // tab received successive hot updates, leaving a dead duplicate copy. Without
    // it, edits trigger a clean full reload instead. Production is unaffected
    // (prefresh is dev-only). Re-enable by removing this option if it's ever fixed.
    preact({ prefreshEnabled: false }),
    cspMeta(),
    VitePWA({
      registerType: 'autoUpdate',
      // External registration script (not inline) so `script-src 'self'` allows it.
      injectRegister: 'script',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Serendipity',
        short_name: 'Serendipity',
        description: 'Rediscover your own Spotify listening history.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
});
