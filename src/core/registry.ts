import type { Entity } from '../types/playevent.js';
import type { Candidate, Engine } from './serendipity.js';

/** What an inline mad-lib blank collects, if anything. */
export type ParamKind = 'none' | 'date' | 'duration' | 'year';
export type ParamValue = string | number;

export type QueryGroup = 'Frequency' | 'Recency' | 'Date' | 'Pattern' | 'Behavior';

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
  run(engine: Engine, ctx: { entity: Entity; param?: ParamValue }): Candidate[];
}

const ALL: Entity[] = ['artist', 'album', 'track'];
const TRACK_ONLY: Entity[] = ['track'];

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

  // --- Recency -------------------------------------------------------------
  { id: 'dormant', group: 'Recency', phrase: "I haven't played in {duration}", entities: ALL, param: 'duration',
    run: (e, c) => e.dormant({ entity: c.entity, minDays: numberParam(c.param, 365) }) },
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

  // --- Pattern -------------------------------------------------------------
  { id: 'late-night', group: 'Pattern', phrase: 'I play late at night', entities: ALL, param: 'none',
    run: (e, c) => e.byTimeOfDay({ entity: c.entity, fromHour: 0, toHour: 5 }) },
  { id: 'morning', group: 'Pattern', phrase: 'I play in the morning', entities: ALL, param: 'none',
    run: (e, c) => e.byTimeOfDay({ entity: c.entity, fromHour: 6, toHour: 11 }) },
  { id: 'mileage', group: 'Pattern', phrase: "I've spent the most hours on", entities: ALL, param: 'none',
    run: (e, c) => e.mileage({ entity: c.entity }) },

  // --- Behavior (track-only; export-only fields) ---------------------------
  { id: 'skip', group: 'Behavior', phrase: 'I always skip', entities: TRACK_ONLY, param: 'none',
    run: (e) => e.skipMagnet({}) },
  { id: 'finish', group: 'Behavior', phrase: 'I always let finish', entities: TRACK_ONLY, param: 'none',
    run: (e) => e.alwaysFinish({}) },
  { id: 'repeat', group: 'Behavior', phrase: 'I put on repeat', entities: TRACK_ONLY, param: 'none',
    run: (e) => e.onRepeat({}) },
  { id: 'deep-cut', group: 'Behavior', phrase: 'a deep cut by an artist I love', entities: TRACK_ONLY, param: 'none',
    run: (e) => e.deepCut({}) },
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
