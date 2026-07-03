# Serendipity — Open TODOs

_Last updated: 2026-07-03 (portfolio-polish pass: GUI overhaul, criteria expansion, bug fixes)_

## Resolved this pass (root causes found)

### 1. "Two clicks to execute" — CLOSED (two real causes, both fixed)
- **Root cause A (main):** with a small candidate pool, the weighted draw regularly
  returned the *pick already on screen* — visually a no-op click. Fix: `surprise()`
  excludes the current result whenever the pool has an alternative
  (`src/app.tsx`), locked by `src/app.norepeat.test.ts` (12 consecutive clicks,
  no repeats) and re-verified live (headless Chrome, production build).
- **Root cause B (contributing):** the PRNG was re-seeded `rng(Date.now())` *per
  click*, so two clicks in the same millisecond replayed the identical pick. Now
  one session-lifetime PRNG.
- Also: the result card now remounts per pick (entrance animation replays as
  feedback) and scrolls itself into view — on small screens a new result could
  land below the fold, reading as "nothing happened".

### 2. Fonts silently broken in production — FIXED
- `style.css` pulled Inter/Outfit from `fonts.googleapis.com`, but the production
  CSP is `default-src 'self'` with no font/style allowances — prod silently fell
  back to system fonts (dev looked different from prod). Fonts are now bundled
  (`@fontsource-variable/*`, imported in `src/main.tsx`); latin subsets are
  precached by the service worker so the PWA is styled offline. Verified live:
  `document.fonts.check('16px "Inter Variable"')` → true on the built app, zero
  CSP console errors.

### 3. Clickjacking "fix" was cosmetic — FIXED (audit corrected)
- `frame-ancestors 'none'` was delivered via the CSP `<meta>` tag, which the spec
  **ignores** (Chrome logged an error on every load). Real control now:
  `src/framebust.ts` — the app refuses to mount inside a frame. Live-verified
  with a hostile-iframe probe. `SECURITY_AUDIT.md` VULN-011 updated.

### 4. Smaller fixes
- Stale "No match" note persisted across entity/criterion switches — cleared now.
- Free-text year input allowed out-of-range years (and `Number('') → 0` while
  typing); replaced with a dropdown of the dataset's actual years, newest first.
- Date params defaulted to *today*, which a historical export never contains
  (instant no-match); now default to the export's last day, bounded min/max.
- `thisDayInHistory` included the *current* year's plays in "past years".
- Import worker had no `onerror` → a crashed worker left "Importing…" forever.
- Re-choosing the same file after a failed import didn't re-fire `onChange`
  (input value never reset).
- `relTime` grammar: "1 days ago" / "1 months ago" → singular.
- Onboarding copy: missing space before the `Streaming_History_*.json` code chip
  (JSX newline collapsing).

### 5. Player bar frozen on the previous track — CLOSED (root cause found)
- **Reported:** "Play here" changed the audio but not the visuals; the bar only
  caught up after unrelated UI interaction.
- **Root cause:** the post-play seed loop in `useSpotify.play()` broke on the
  *first truthy* `getCurrentState()` — on every play after the first, that is
  the still-playing *previous* track. And the SDK's `player_state_changed`
  event is unreliable for API-initiated track changes, so nothing corrected it.
- **Fix (two layers):** `play(uri)` now polls until the reported state is for
  the requested uri (falling back to the freshest state), and a 1 s reconcile
  loop compares polled SDK state against what's shown — track change, external
  pause/resume, or a >2 s position jump re-syncs the bar. Locked by
  `src/ui/useSpotify.test.ts` (the poll test fails against the old logic —
  verified by temporarily reverting it).

### 6. Volume controls — ADDED
- The player bar now has a mute toggle + volume slider (slider hides ≤540 px,
  mute stays). `PlayerController` gained `setVolume`/`getVolume`; the hook syncs
  its initial value from the device and restores the last non-zero volume on
  unmute.

## Still open (need a live connected session)

### Artwork enrichment when connected
- `src/app.enrich.test.ts` proves the connected path renders `img.art` with the
  network stubbed, so the app logic is sound; live failures would be
  token/scope/404 issues. **Capture:** Network tab → status of
  `GET /v1/tracks/{id}` and `/v1/artists/{id}` after a suggestion.

### Play-here latency
- Partly inherent (stream start + `PUT /me/player/play` round trip). Possible
  improvement: pre-warm the SDK on *connect* (a valid user gesture) instead of
  first play. **Capture:** time-to-audio after the `play` PUT returns.

## Feature ideas (not started)
- Shareable "pick of the day" card (canvas render → share sheet).
- Exclusion memory ("never show me this again").
- Multi-criteria combination ("an artist I played a lot in 2021 *and* haven't
  heard in a year").
