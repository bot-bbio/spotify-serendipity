import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Read the stylesheet from disk. A Vite `?raw` import would be tidier, but
// vitest stubs any `.css` import to an empty string (its default `css: false`),
// so the file must be read directly. `import.meta.url` + `new URL` mirrors the
// worker-loading idiom already used in app.tsx. (node:fs is typed by the local
// sliver in src/test/node-shims.d.ts.)
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

// style.css is authored by hand, so a `var(--foo)` that names a custom property
// never declared in `:root` fails silently: the browser falls back to the
// inherited value instead of erroring. This suite guards against that class of
// bug (originally: `--accent-hover`, referenced 4× but never declared, so the
// entity dropdown / selected criterion chip / card "kind" label rendered white
// instead of green).

/** Custom-property *declarations* — `--name:` only appears at a declaration. */
function declaredProps(src: string): Set<string> {
  return new Set([...src.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

/** Custom-property *references* — `var(--name)` / `var(--name, fallback)`. */
function referencedProps(src: string): Set<string> {
  return new Set([...src.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
}

describe('style.css custom properties', () => {
  it('declares every custom property it references', () => {
    const declared = declaredProps(css);
    const referenced = referencedProps(css);
    const missing = [...referenced].filter((p) => !declared.has(p));
    expect(missing).toEqual([]);
  });

  it('declares --accent-hover (regression: was referenced but undefined)', () => {
    expect(declaredProps(css).has('--accent-hover')).toBe(true);
  });
});
