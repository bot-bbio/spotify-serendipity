import type { PlayEvent } from '../types/playevent.js';
import { rng } from '../core/random.js';

interface ArtistSpec {
  name: string;
  weight: number; // relative play share (Zipf-ish)
  tracks: string[];
  album: string;
}

const ARTISTS: ArtistSpec[] = [
  { name: 'Aphex Twin', weight: 40, album: 'Selected Ambient Works', tracks: ['Xtal', 'Ageispolis', 'Pulsewidth', 'Green Calx'] },
  { name: 'Boards of Canada', weight: 30, album: 'Music Has the Right to Children', tracks: ['Roygbiv', 'Telephasic Workshop', 'Aquarius'] },
  { name: 'Radiohead', weight: 24, album: 'In Rainbows', tracks: ['15 Step', 'Nude', 'Weird Fishes', 'Reckoner'] },
  { name: 'Burial', weight: 18, album: 'Untrue', tracks: ['Archangel', 'Near Dark', 'Untrue'] },
  { name: 'Four Tet', weight: 14, album: 'Rounds', tracks: ['She Moves She', 'My Angel Rocks Back and Forth'] },
  { name: 'Bonobo', weight: 11, album: 'Black Sands', tracks: ['Kiara', 'Kong', 'Eyesdown'] },
  { name: 'Caribou', weight: 8, album: 'Swim', tracks: ['Odessa', 'Sun'] },
  { name: 'Floating Points', weight: 6, album: 'Crush', tracks: ['Last Bloom', 'LesAlpx'] },
  { name: 'Jon Hopkins', weight: 4, album: 'Immunity', tracks: ['Open Eye Signal', 'Immunity'] },
  { name: 'Tycho', weight: 3, album: 'Dive', tracks: ['A Walk', 'Hours'] },
  { name: 'Nils Frahm', weight: 2, album: 'Spaces', tracks: ['Says', 'Hammers'] },
  { name: 'Oneohtrix Point Never', weight: 1, album: 'R Plus Seven', tracks: ['Americans', 'Still Life'] },
];

const REASONS_END = ['trackdone', 'trackdone', 'trackdone', 'fwdbtn', 'endplay'];
const PLATFORMS = ['iOS 17.2', 'OS X', 'Android', 'iOS 17.2'];
const COUNTRIES = ['CA', 'CA', 'CA', 'US', 'GB', 'FR'];

/**
 * Deterministic synthetic listening history with a Zipfian artist distribution,
 * spread across several years. Used for UI demos and engine smoke tests before a
 * real export is imported.
 */
export function makeSynthetic(count = 4000, seed = 1): PlayEvent[] {
  const rand = rng(seed);
  const totalWeight = ARTISTS.reduce((a, s) => a + s.weight, 0);
  const startMs = Date.UTC(2019, 0, 1);
  const endMs = Date.UTC(2025, 5, 1);
  const events: PlayEvent[] = [];

  for (let i = 0; i < count; i++) {
    const artist = pickWeighted(rand, totalWeight);
    const track = artist.tracks[Math.floor(rand() * artist.tracks.length)];
    const trackUri = `spotify:track:${slug(artist.name)}_${slug(track)}`;
    const ts = new Date(startMs + rand() * (endMs - startMs)).toISOString();
    const reasonEnd = REASONS_END[Math.floor(rand() * REASONS_END.length)];
    const msPlayed = reasonEnd === 'fwdbtn' ? Math.floor(rand() * 25_000) : 90_000 + Math.floor(rand() * 180_000);
    events.push({
      ts,
      msPlayed,
      artist: artist.name,
      track,
      trackUri,
      album: artist.album,
      reasonStart: rand() < 0.5 ? 'clickrow' : 'trackdone',
      reasonEnd,
      shuffle: rand() < 0.4,
      platform: PLATFORMS[Math.floor(rand() * PLATFORMS.length)],
      country: COUNTRIES[Math.floor(rand() * COUNTRIES.length)],
    });
  }
  return events;
}

function pickWeighted(rand: () => number, total: number): ArtistSpec {
  let r = rand() * total;
  for (const a of ARTISTS) {
    r -= a.weight;
    if (r < 0) return a;
  }
  return ARTISTS[ARTISTS.length - 1];
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
