/**
 * Clickjacking guard (VULN-011). The proper control — `frame-ancestors` — only
 * works as an HTTP header, which GitHub Pages cannot send; in a <meta> CSP the
 * browser ignores it. So the app refuses to *operate* inside a frame instead:
 * before mounting, the entry point checks for an ancestor browsing context and
 * renders an inert notice rather than the UI. Blanking (not navigating) is
 * deliberate — a sandboxed embed can block top-navigation frame-busting, but it
 * cannot stop the page from declining to render its own controls.
 */

/** The two references the check needs — structural, so tests can pass doubles. */
export interface FrameRefs {
  top: unknown;
  self: unknown;
}

/** True when running embedded in another browsing context (framed). */
export function isFramed(win: FrameRefs): boolean {
  // Cross-origin `top` access can throw on property reads, but an identity
  // comparison of the references is always safe.
  return win.top !== win.self;
}

/** Replace the app container with a plain notice; returns true when framed. */
export function guardAgainstFraming(doc: Document, win: FrameRefs): boolean {
  if (!isFramed(win)) return false;
  const root = doc.getElementById('app');
  if (root) {
    root.textContent = 'Serendipity does not run inside a frame — open it directly.';
  }
  return true;
}
