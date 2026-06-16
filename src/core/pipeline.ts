import type { PlayEvent } from '../types/playevent.js';
import { type Dataset, encode } from './columnar.js';
import { mergeDedupe } from './dedupe.js';
import { Engine } from './serendipity.js';
import { buildIndex, type StatsIndex } from './statsIndex.js';

export interface Built {
  dataset: Dataset;
  index: StatsIndex;
}

/** events → merged/deduped → columnar dataset → materialized index. */
export function build(events: readonly PlayEvent[]): Built {
  const dataset = encode(mergeDedupe(events));
  return { dataset, index: buildIndex(dataset) };
}

/** Convenience: build everything and wrap it in a query `Engine`. */
export function buildEngine(events: readonly PlayEvent[], now?: number): Engine {
  const { dataset, index } = build(events);
  return new Engine(dataset, index, now);
}
