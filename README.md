# Serendipity

A personal, client-side PWA that resurfaces a **random artist, album, or song from
your own Spotify listening past** based on simple, human criteria — "an artist I
played a lot in 2021", "something I haven't heard in a year", "a song I always skip",
"what I listened to on this day in past years". The serendipity comes from your own
history, assembled mad-lib style.

## Query criteria

Twenty-two criteria across six groups, each a mad-lib phrase with inline blanks
(year, date, duration, weekday, daypart, season, device):

| Group | Examples |
|---|---|
| **Frequency** | play constantly · a lot · in rotation · now and then · forgotten · on heavy rotation in *{year}* |
| **Recency** | not played in *{duration}* · discovered in the last *{duration}* · binged then dropped · loved, left, came back |
| **Date** | on *{date}* · this day in past years · back in *{year}* · earliest discoveries · first heard on *{date}* |
| **Pattern** | in the *{morning/evening/late at night}* · on *{Mondays…Sundays}* · in the *{season}* · most hours spent |
| **Context** | on *{my phone / my computer / the web player / a TV or console}* · while traveling (home country inferred) |
| **Behavior** | always skip · always finish · put on repeat · deep cuts by loved artists · one-song artists |

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
  track in-browser with the Web Playback SDK (Spotify Premium): play/pause, seek,
  volume + mute in a floating transport bar, plus one-tap **add to queue** and a
  **♥ save** that knows whether the track is already in your library.
- **Time Capsules** — one click turns the current phrase into a *real private
  playlist* on your account: up to 25 tracks sampled from your history, a
  specific title per criterion ("Throwbacks from July 4", "Back in 2021",
  "Late-night soundtrack"…), plus a canvas-generated cover with the phrase
  rendered on it.
- **Then vs Now** — your live top artists, songs, or albums (4-week / 6-month /
  ~1-year affinity) joined against your export era: still on repeat, new era,
  lost classics — with artwork looked up for the lost ones.
- **Optional enrichment** (Authorization Code + PKCE) for artist artwork and genres.
- **Self-contained by policy** — strict CSP (`default-src 'self'`), fonts bundled
  locally (no CDN), a frame guard against clickjacking, and offline-capable via a
  precaching service worker. Every Web API call uses the current, non-deprecated
  endpoints (`/me/playlists`, `/playlists/{id}/items`, the consolidated
  `/me/library`, `/me/top`), with 429 backoff honoring `Retry-After`.

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

The app's home screen walks through the same steps under **"How do I get my
Spotify data?"**:

1. Open [spotify.com/account/privacy](https://www.spotify.com/account/privacy/)
   and sign in.
2. Under **Download your data**, tick **Extended streaming history** only, and
   press *Request data*.
3. Confirm the request via the email Spotify sends.
4. Wait for the "your data is ready" email (usually a few days, up to 30) and
   download `my_spotify_data.zip`.
5. Unzip it and import the `Streaming_History_Audio_*.json` files in the app —
   everything is parsed and stored locally on your device, and "remove data"
   deletes it.

## Project status

Phases 1–2 complete — offline engine, mad-lib UI, and deep-link play, plus PKCE auth,
in-browser Web Playback SDK, and artist/track enrichment. Phase 3 polish underway:
restyled Spotify-dark UI (self-hosted variable fonts, SVG iconography), six criteria
groups, Time Capsule playlists, Then vs Now, and live browser verification of the
production build. 126 passing tests.
