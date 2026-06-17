import preact from '@preact/preset-vite';
import { type Plugin, defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Content-Security-Policy (VULN-005). GitHub Pages cannot set HTTP headers, so the
// policy ships as a <meta> tag. `connect-src` is pre-scoped for the Phase 2/3 OAuth
// flow (Spotify API) and is the main thing standing between a future XSS and token
// theft once the localStorage bearer / access tokens exist.
const CSP =
  "default-src 'self'; " +
  "connect-src 'self' https://api.spotify.com; " +
  "object-src 'none'; " +
  "base-uri 'none'";

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
  plugins: [
    preact(),
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
        theme_color: '#1db954',
        background_color: '#0e1014',
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
