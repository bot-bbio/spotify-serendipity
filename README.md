# Serendipity

A personal, client-side PWA that resurfaces a **random artist, album, or song from
your own Spotify listening past** based on simple, human criteria — "an artist I
played a lot in 2021", "something I haven't heard in a year", "a song I always skip",
"what I listened to on this day in past years". The serendipity comes from your own
history, assembled mad-lib style.

## Why your history, not Spotify's recommendations

Spotify's live Web API exposes almost no listening history (the *recently played*
endpoint returns only the last 50 tracks ever), and the Nov 2024 API changes removed
the recommendation endpoints for new apps. The complete record lives in your **GDPR
"Extended Streaming History" export** — a timestamped JSON of every play you can
download from Spotify's privacy settings. Serendipity parses that export entirely on
your device and lets you query it.

## Architecture

- **Standalone client-side PWA** — your data never leaves the browser. Parsed into a
  compact columnar store in IndexedDB; queried against a precomputed stats index.
- **Listen to any pick** — open it in the Spotify app via a deep link, or play the full
  track in-browser with the Web Playback SDK (Spotify Premium).
- **Optional enrichment** (Authorization Code + PKCE) for artist artwork and genres.

## Data flow

```
Export .json ─▶ normalize ─▶ PlayEvent[] ─▶ columnar store (IndexedDB)
                                                 │
                                    stats index (materialized)
                                                 │
                          serendipity engine ─▶ mad-lib UI ─▶ ▶ play (in-app / in-browser)
```

## Getting started

```bash
npm install
npm test        # run the engine test suite
npm run dev     # start the app (runs on synthetic data until you import an export)
```

## Using your own data

1. Spotify → Privacy settings → *Download your data* → tick **only** "Extended
   streaming history". Delivery takes ~1–5 days.
2. Unzip and import the `Streaming_History_*.json` files in the app. Everything is
   processed locally.

## Project status

Phases 1–2 complete — offline engine, mad-lib UI, and deep-link play, plus PKCE auth,
in-browser Web Playback SDK, and artist/track enrichment. 52 passing tests. Phase 3
(ship polish + GitHub Pages deploy) is in progress.
