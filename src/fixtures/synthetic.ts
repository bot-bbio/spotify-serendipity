import type { PlayEvent } from '../types/playevent.js';
import { rng } from '../core/random.js';

/** Optional listening habits, applied to ~75% of an artist's plays (local time). */
interface Bias {
  /** Concentrate plays into this local hour window (inclusive). */
  hour?: [number, number];
  /** Concentrate plays onto Saturday/Sunday. */
  weekend?: boolean;
  /** Concentrate plays onto one weekday (0 = Sunday). */
  weekday?: number;
  /** Concentrate plays into these local months (0 = January). */
  months?: number[];
}

interface ArtistSpec {
  name: string;
  weight: number; // relative play share (Zipf-ish)
  tracks: string[];
  album: string;
  bias?: Bias;
}

// Several artists carry temporal habits so the Pattern criteria (daypart,
// weekday, season) have something to find in the demo — a uniform random
// timeline would leave that whole group answering "no match".
const ARTISTS: ArtistSpec[] = [
  { name: 'Aphex Twin', weight: 40, album: 'Selected Ambient Works', tracks: ['Xtal', 'Ageispolis', 'Pulsewidth', 'Green Calx'] },
  { name: 'Boards of Canada', weight: 30, album: 'Music Has the Right to Children', tracks: ['Roygbiv', 'Telephasic Workshop', 'Aquarius'] },
  { name: 'Radiohead', weight: 24, album: 'In Rainbows', tracks: ['15 Step', 'Nude', 'Weird Fishes', 'Reckoner'] },
  { name: 'Burial', weight: 18, album: 'Untrue', tracks: ['Archangel', 'Near Dark', 'Untrue'], bias: { hour: [0, 4] } },
  { name: 'Four Tet', weight: 14, album: 'Rounds', tracks: ['She Moves She', 'My Angel Rocks Back and Forth'] },
  { name: 'Bonobo', weight: 11, album: 'Black Sands', tracks: ['Kiara', 'Kong', 'Eyesdown'], bias: { weekend: true } },
  { name: 'Caribou', weight: 8, album: 'Swim', tracks: ['Odessa', 'Sun'], bias: { months: [5, 6, 7] } },
  { name: 'Floating Points', weight: 6, album: 'Crush', tracks: ['Last Bloom', 'LesAlpx'], bias: { weekday: 1 } },
  { name: 'Jon Hopkins', weight: 4, album: 'Immunity', tracks: ['Open Eye Signal', 'Immunity'] },
  { name: 'Tycho', weight: 3, album: 'Dive', tracks: ['A Walk', 'Hours'], bias: { hour: [6, 10] } },
  { name: 'Nils Frahm', weight: 2, album: 'Spaces', tracks: ['Says', 'Hammers'], bias: { months: [11, 0, 1] } },
  { name: 'Oneohtrix Point Never', weight: 1, album: 'R Plus Seven', tracks: ['Americans', 'Still Life'] },
];

const REASONS_END = ['trackdone', 'trackdone', 'trackdone', 'fwdbtn', 'endplay'];
const PLATFORMS = ['iOS 17.2', 'iOS 17.2', 'OS X', 'Android', 'Web Player (Chrome)', 'PS5'];
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
    const ts = new Date(applyBias(startMs + rand() * (endMs - startMs), artist.bias, rand)).toISOString();
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

/**
 * Nudge a uniform timestamp into the artist's habitual hour/weekday/month.
 * Biases apply in *local* time because the stats index buckets in local time —
 * the demo should feel right in the viewer's own timezone.
 */
function applyBias(ms: number, bias: Bias | undefined, rand: () => number): number {
  if (!bias || rand() > 0.75) return ms;
  const d = new Date(ms);
  if (bias.months) {
    d.setMonth(bias.months[Math.floor(rand() * bias.months.length)]);
  }
  if (bias.weekend) {
    const target = rand() < 0.5 ? 6 : 0; // Saturday or Sunday
    d.setDate(d.getDate() + (target - d.getDay()));
  }
  if (bias.weekday !== undefined) {
    d.setDate(d.getDate() + (bias.weekday - d.getDay()));
  }
  if (bias.hour) {
    const [from, to] = bias.hour;
    d.setHours(from + Math.floor(rand() * (to - from + 1)));
  }
  return d.getTime();
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
