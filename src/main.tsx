import { render } from 'preact';
import { App } from './app.js';
import './style.css';

const root = document.getElementById('app');

// Mount exactly once. If the entry is ever evaluated (or `render` invoked) twice
// within the same page load, a second *fresh* App tree would be appended to #app
// — surfacing as two `<main class="app">` with the duplicate left inert. The
// container-empty guard makes the mount idempotent; the warning confirms (and
// counts) any duplicate mount that was prevented.
if (root && root.childElementCount === 0) {
  render(<App />, root);
} else if (root) {
  console.warn('[serendipity] prevented a duplicate mount into #app');
}
