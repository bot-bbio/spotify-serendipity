import type { Entity } from '../types/playevent.js';
import type { Candidate, Engine } from './serendipity.js';

/** What an inline mad-lib blank collects, if anything. */
export type ParamKind = 'none' | 'date' | 'duration' | 'year' | 'choice';
export type ParamValue = string | number;

export type QueryGroup = 'Frequency' | 'Recency' | 'Date' | 'Pattern' | 'Context' | 'Behavior';

/** One option of a `choice` param; `value` is what `run` receives. */
export interface ParamChoice {
  value: string;
  label: string;
}

/**
 * A single mad-lib criterion. The UI enumerates these to render the criterion pill,
 * knows from `param` whether to reveal an inline control, and disables phrases whose
 * `entities` don't include the chosen entity. Adding a serendipity mode is one entry.
 */
export interface QueryDescriptor {
  id: string;
  group: QueryGroup;
  /** Mad-lib text; `{…}` marks the inline blank. */
  phrase: string;
  entities: Entity[];
  param: ParamKind;
  /** Options for a `choice` param (required when `param === 'choice'`). */
  choices?: ParamChoice[];
  run(engine: Engine, ctx: { entity: Entity; param?: ParamValue }): Candidate[];
}

const ALL: Entity[] = ['artist', 'album', 'track'];
const TRACK_ONLY: Entity[] = ['track'];
const ARTIST_ONLY: Entity[] = ['artist'];

/** Hour-of-day windows behind the "I tend to play {daypart}" choices. */
const DAYPARTS: Record<string, { from: number; to: number }> = {
  morning: { from: 5, to: 11 },
  afternoon: { from: 12, to: 17 },
  evening: { from: 18, to: 23 },
  'late-night': { from: 0, to: 4 },
};

/** Month-of-year windows (local, wrapping) behind the "{season}" choices. */
const SEASONS: Record<string, { from: number; to: number }> = {
  winter: { from: 11, to: 1 },
  spring: { from: 2, to: 4 },
  summer: { from: 5, to: 7 },
  autumn: { from: 8, to: 10 },
};

/** Platform-name needles behind the "{platform}" device-family choices. */
const PLATFORMS: Record<string, string[]> = {
  phone: ['ios', 'iphone', 'android', 'mobile'],
  computer: ['windows', 'os x', 'macos', 'linux', 'desktop'],
  web: ['web'],
  tv: ['tv', 'cast', 'roku', 'ps3', 'ps4', 'ps5', 'xbox', 'partner'],
};

export const REGISTRY: QueryDescriptor[] = [
  // --- Frequency -----------------------------------------------------------
  { id: 'freq-obsessed', group: 'Frequency', phrase: 'I play constantly', entities: ALL, param: 'none',
    run: (e, c) => e.byFrequency({ entity: c.entity, band: 'obsessed' }) },
  { id: 'freq-favorite', group: 'Frequency', phrase: 'I play a lot', entities: ALL, param: 'none',
    run: (e, c) => e.byFrequency({ entity: c.entity, band: 'favorite' }) },
  { id: 'freq-regular', group: 'Frequency', phrase: 'I keep in rotation', entities: ALL, param: 'none',
    run: (e, c) => e.byFrequency({ entity: c.entity, band: 'regular' }) },
  { id: 'freq-occasional', group: 'Frequency', phrase: 'I only play now and then', entities: ALL, param: 'none',
    run: (e, c) => e.byFrequency({ entity: c.entity, band: 'occasional' }) },
  { id: 'freq-rare', group: 'Frequency', phrase: "I'd forgotten I knew", entities: ALL, param: 'none',
    run: (e, c) => e.byFrequency({ entity: c.entity, band: 'rare' }) },
  { id: 'top-year', group: 'Frequency', phrase: 'I had on heavy rotation in {year}', entities: ALL, param: 'year',
    run: (e, c) => {
      const y = numberParam(c.param, new Date().getUTCFullYear());
      return e.byFrequency({
        entity: c.entity,
        band: 'favorite',
        within: { start: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1) },
      });
    } },

  // --- Recency -------------------------------------------------------------
  { id: 'dormant', group: 'Recency', phrase: "I haven't played in {duration}", entities: ALL, param: 'duration',
    run: (e, c) => e.dormant({ entity: c.entity, minDays: numberParam(c.param, 365) }) },
  { id: 'new-find', group: 'Recency', phrase: 'I discovered in the last {duration}', entities: ALL, param: 'duration',
    run: (e, c) => e.discovered({ entity: c.entity, withinDays: numberParam(c.param, 365) }) },
  { id: 'binge', group: 'Recency', phrase: 'I binged once, then dropped', entities: ALL, param: 'none',
    run: (e, c) => e.binge({ entity: c.entity }) },
  { id: 'comeback', group: 'Recency', phrase: 'I loved, left, and came back to', entities: ALL, param: 'none',
    run: (e, c) => e.comeback({ entity: c.entity }) },

  // --- Date ----------------------------------------------------------------
  { id: 'on-date', group: 'Date', phrase: 'I listened to on {date}', entities: ALL, param: 'date',
    run: (e, c) => e.onDate({ entity: c.entity, date: String(c.param ?? '') }) },
  { id: 'this-day', group: 'Date', phrase: 'from this day in past years', entities: ALL, param: 'none',
    run: (e, c) => e.thisDayInHistory({ entity: c.entity }) },
  { id: 'from-year', group: 'Date', phrase: 'I played back in {year}', entities: ALL, param: 'year',
    run: (e, c) => e.fromYear({ entity: c.entity, year: numberParam(c.param, new Date().getUTCFullYear()) }) },
  { id: 'first', group: 'Date', phrase: 'I discovered earliest', entities: ALL, param: 'none',
    run: (e, c) => e.firstPlayed({ entity: c.entity }) },
  { id: 'discovered-on', group: 'Date', phrase: 'I first heard on {date}', entities: ALL, param: 'date',
    run: (e, c) => e.firstPlayed({ entity: c.entity, date: String(c.param ?? '') }) },

  // --- Pattern -------------------------------------------------------------
  { id: 'daypart', group: 'Pattern', phrase: 'I tend to play {daypart}', entities: ALL, param: 'choice',
    choices: [
      { value: 'morning', label: 'in the morning' },
      { value: 'afternoon', label: 'in the afternoon' },
      { value: 'evening', label: 'in the evening' },
      { value: 'late-night', label: 'late at night' },
    ],
    run: (e, c) => {
      const w = DAYPARTS[String(c.param)] ?? DAYPARTS['late-night'];
      return e.byTimeOfDay({ entity: c.entity, fromHour: w.from, toHour: w.to });
    } },
  { id: 'weekday', group: 'Pattern', phrase: 'I play on {weekday}', entities: ALL, param: 'choice',
    choices: [
      { value: '1', label: 'Mondays' },
      { value: '2', label: 'Tuesdays' },
      { value: '3', label: 'Wednesdays' },
      { value: '4', label: 'Thursdays' },
      { value: '5', label: 'Fridays' },
      { value: '6', label: 'Saturdays' },
      { value: '0', label: 'Sundays' },
    ],
    run: (e, c) => e.byWeekday({ entity: c.entity, day: numberParam(c.param, 1) % 7 }) },
  { id: 'season', group: 'Pattern', phrase: 'I play in {season}', entities: ALL, param: 'choice',
    choices: [
      { value: 'winter', label: 'the winter' },
      { value: 'spring', label: 'the spring' },
      { value: 'summer', label: 'the summer' },
      { value: 'autumn', label: 'the autumn' },
    ],
    run: (e, c) => {
      const w = SEASONS[String(c.param)] ?? SEASONS.summer;
      return e.bySeason({ entity: c.entity, fromMonth: w.from, toMonth: w.to });
    } },
  { id: 'mileage', group: 'Pattern', phrase: "I've spent the most hours on", entities: ALL, param: 'none',
    run: (e, c) => e.mileage({ entity: c.entity }) },

  // --- Context (where / what device the plays came from) --------------------
  { id: 'platform', group: 'Context', phrase: 'I played on {platform}', entities: ALL, param: 'choice',
    choices: [
      { value: 'phone', label: 'my phone' },
      { value: 'computer', label: 'my computer' },
      { value: 'web', label: 'the web player' },
      { value: 'tv', label: 'a TV or console' },
    ],
    run: (e, c) => e.byPlatform({ entity: c.entity, platform: PLATFORMS[String(c.param)] ?? [] }) },
  { id: 'traveling', group: 'Context', phrase: 'I played while traveling', entities: ALL, param: 'none',
    run: (e, c) => e.whileTraveling({ entity: c.entity }) },

  // --- Behavior (export-only fields) ----------------------------------------
  { id: 'skip', group: 'Behavior', phrase: 'I always skip', entities: TRACK_ONLY, param: 'none',
    run: (e) => e.skipMagnet({}) },
  { id: 'finish', group: 'Behavior', phrase: 'I always let finish', entities: TRACK_ONLY, param: 'none',
    run: (e) => e.alwaysFinish({}) },
  { id: 'repeat', group: 'Behavior', phrase: 'I put on repeat', entities: TRACK_ONLY, param: 'none',
    run: (e) => e.onRepeat({}) },
  { id: 'deep-cut', group: 'Behavior', phrase: 'a deep cut by an artist I love', entities: TRACK_ONLY, param: 'none',
    run: (e) => e.deepCut({}) },
  { id: 'one-hit', group: 'Behavior', phrase: 'I only ever play one song by', entities: ARTIST_ONLY, param: 'none',
    run: (e) => e.oneHitWonder() },
];

export const REGISTRY_BY_ID: Map<string, QueryDescriptor> = new Map(
  REGISTRY.map((d) => [d.id, d]),
);

/** Descriptors applicable to a given entity, for building the criterion pill. */
export function descriptorsFor(entity: Entity): QueryDescriptor[] {
  return REGISTRY.filter((d) => d.entities.includes(entity));
}

function numberParam(p: ParamValue | undefined, fallback: number): number {
  const n = typeof p === 'number' ? p : Number(p);
  return Number.isFinite(n) ? n : fallback;
}
