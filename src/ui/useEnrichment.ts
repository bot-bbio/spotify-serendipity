/**
 * Best-effort result-card enrichment (STRATEGY §8): artwork + genres for the
 * current pick, fetched from the live Web API once the user is connected.
 *
 * The export only gives us track URIs, so we enrich from the representative track:
 * `GET /tracks/{id}` yields the album art and the artist id, and `GET /artists/{id}`
 * yields the artist image + genres. For an artist pick we prefer the artist photo;
 * for an album/track pick we use the album cover. Enrichment is purely additive —
 * any failure (offline, rate limit, no token) leaves the card exactly as it was.
 */

import { useEffect, useState } from 'preact/hooks';
import type { EntityKind } from '../core/statsIndex.js';
import { getArtist, getTrack, parseTrackUri } from '../api/spotify.js';

export interface Enrichment {
  imageUrl?: string;
  genres: string[];
}

/** Smaller of the available images for a card-sized thumbnail (Spotify sorts largest-first). */
function thumb(images: { url: string }[]): string | undefined {
  return images[1]?.url ?? images[0]?.url;
}

export function useEnrichment(
  connected: boolean,
  kind: EntityKind | undefined,
  uri: string | undefined,
): Enrichment | null {
  const [data, setData] = useState<Enrichment | null>(null);

  useEffect(() => {
    // Clear immediately so the previous pick's artwork never lingers on a new one.
    setData(null);
    const trackId = uri ? parseTrackUri(uri) : null;
    if (!connected || !kind || !trackId) return;

    let cancelled = false;
    void (async () => {
      try {
        const track = await getTrack(trackId);
        const albumArt = thumb(track.album.images);
        const artistId = track.artists[0]?.id;

        let artistImg: string | undefined;
        let genres: string[] = [];
        if (artistId) {
          const artist = await getArtist(artistId);
          artistImg = thumb(artist.images);
          genres = artist.genres;
        }

        if (cancelled) return;
        setData({ imageUrl: kind === 'artist' ? (artistImg ?? albumArt) : albumArt, genres });
      } catch {
        // Enrichment is optional — swallow errors and leave the card un-enriched.
        if (!cancelled) setData(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, kind, uri]);

  return data;
}
