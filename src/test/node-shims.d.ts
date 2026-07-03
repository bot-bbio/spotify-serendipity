/**
 * Minimal ambient declarations for the sliver of Node built-ins used by tests
 * that read source files from disk (e.g. the style.css custom-property lint).
 * The project deliberately omits @types/node so app code stays browser-only
 * (see tsconfig `types` and src/test/setup.ts's local `process` sliver) — this
 * declares only what a test needs rather than pulling the whole Node typings
 * surface into `src`, where it would let app code reference `process`/`Buffer`
 * and still typecheck.
 */
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
