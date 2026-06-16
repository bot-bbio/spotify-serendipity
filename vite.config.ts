import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Static, client-only PWA. `base` is relative so it can be served from a GitHub
// Pages project path without rewriting asset URLs.
export default defineConfig({
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
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
