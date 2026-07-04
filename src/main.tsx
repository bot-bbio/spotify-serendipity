import { render } from 'preact';
import { App } from './app.js';
import { guardAgainstFraming } from './framebust.js';
// Fonts are bundled (fontsource) rather than pulled from fonts.googleapis.com:
// the production CSP only allows 'self', so a Google Fonts @import silently
// failed there — and self-hosting keeps the PWA styled offline.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/outfit/wght.css';
import './style.css';

const root = document.getElementById('app');

// Mount exactly once. If the entry is ever evaluated (or `render` invoked) twice
// within the same page load, a second *fresh* App tree would be appended to #app
// — surfacing as two `<main class="app">` with the duplicate left inert. The
// container-empty guard makes the mount idempotent; the warning confirms (and
// counts) any duplicate mount that was prevented.
if (guardAgainstFraming(document, window)) {
  // Framed (clickjacking risk): the guard rendered an inert notice; do not mount.
} else if (root && root.childElementCount === 0) {
  render(<App />, root);
} else if (root) {
  console.warn('[serendipity] prevented a duplicate mount into #app');
}
