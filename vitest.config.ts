import { defineConfig } from 'vitest/config';

// Tests target the pure core (no DOM, no Vite plugins) so the verification loop
// stays fast and decoupled from the app build toolchain. Store tests that need
// IndexedDB opt into the 'jsdom'-free fake-indexeddb shim explicitly.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Pin the timezone so local-time bucketing (statsIndex/serendipity) is
    // deterministic on any machine. See src/test/setup.ts.
    setupFiles: ['./src/test/setup.ts'],
  },
});
