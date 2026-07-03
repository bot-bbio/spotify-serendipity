# Serendipity — Open TODOs

_Last updated: 2026-07-03_

Tracking the bug-fix pass on playback, enrichment, and the mad-lib UI. The key
finding: the three reported symptoms below **do not reproduce in the test harness** —
the app logic resolves correctly in a single click and pulls artwork on the connected
path. They are therefore **live-environment** issues (real Spotify Web API/SDK +
browser), and need DevTools data from a real connected session to fix correctly
(this repo's rule: reproduce before fixing).

## Open bugs (need live DevTools capture)

_Re-confirmed 2026-07-03: the in-repo guards the hypotheses lean on are all present
and correct — idempotent single mount (`src/main.tsx:12`), cached SDK controller
(`src/ui/useSpotify.ts:84` `controllerRef`), shared refresh promise. No new
in-harness reproduction found; these still need a real connected session to fix._

### 1. "Two clicks to execute" — Surprise needs a second click
- **Reported:** Even repeating the same selection, the first Surprise click appears to do nothing; a second click shows a result.
- **Verified:** `src/app.surprise.test.ts` drives entity switches (artist/album/track) + a single Surprise click and asserts a result card of the *correct kind* every time. Passes — so the component state logic is not one-render-behind.
- **Leading hypothesis:** Duplicate app root (the Web Playback SDK double-mount the CSS safety-net at `style.css` `#app > main.app ~ main.app { display:none }` only *hides*), or a touch/`:hover` first-tap being swallowed on mobile.
- **Capture:** Console — click Surprise once: does a card appear? any red errors? Then run `document.querySelectorAll('main.app').length` → expect `1`, a `2` confirms the duplicate-mount theory.

### 2. Artwork broken when connected
- **Reported:** Song/album/artist image does not appear on the suggestion even after connecting Spotify.
- **Verified:** `src/app.enrich.test.ts` runs the real `useEnrichment` hook (network stubbed) with valid base62 URIs; a single click renders the card **and** `img.art` for all three kinds. Passes.
- **Leading hypothesis:** the live enrichment fetch is failing — `GET /v1/tracks/{id}` or `/v1/artists/{id}` returning 401/403/404 (token/scope, or a catalog id that no longer resolves). Not CSP (dev injects no CSP; prod policy already allows `i.scdn.co`/`*.scdn.co`).
- **Capture:** Network tab filtered to `spotify.com` — after a suggestion appears, find `GET …/v1/tracks/…` and `…/v1/artists/…` and record the status codes.

### 3. Every play lags
- **Reported:** Noticeable delay on every "Play here", not just the first.
- **Verified:** controller is cached in `useSpotify` (`controllerRef`), so re-init is not happening per play.
- **Leading hypothesis:** part inherent (stream-start buffering + `PUT /me/player/play` round-trip), part the post-play `getCurrentState` poll loop (up to 5×250ms) in `src/ui/useSpotify.ts`. First-play warm-up can be removed by pre-warming the SDK on connect (the connect click is a valid user gesture for autoplay).
- **Capture:** Network — after "Play here", find `PUT …/v1/me/player/play`: status + rough time-to-audio (1s? 5s? only after a 2nd click?). Need magnitude to tell bug from inherent latency.

## Regression tests added (committed)

- `src/app.surprise.test.ts` — single-click resolution after entity/criterion switches, asserts correct kind.
- `src/app.enrich.test.ts` — connected path renders card + artwork on the first click (real `useEnrichment`, stubbed network).
- Also tightened the outcome assertion (the always-present footer `.muted` span made the prior `.card ?? .muted` check trivially true).
- `src/style.test.ts` — asserts every `var(--foo)` in `style.css` resolves to a declared custom property (guards the `--accent-hover` class of silent-fallback bug). Reads the file via `node:fs` because vitest stubs `.css` imports to empty; `node:fs` typed by the local sliver in `src/test/node-shims.d.ts`.

## Done / not a bug

- **`--accent-hover` was undefined — FIXED (2026-07-03).** Referenced 4× in `src/style.css` (now lines 312/352/364/459) but never declared in `:root`, so the entity dropdown text, selected criterion chip, and card "kind" label fell back to inherited white instead of green. Fix: added `--accent-hover: var(--accent-2);` to `:root`. Guarded by `src/style.test.ts` (verified: both assertions fail with the declaration removed).
- Concurrent refresh race — already fixed (`src/api/auth.ts` shares one `refreshInFlight` promise).
