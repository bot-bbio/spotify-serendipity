import { type IDBPDatabase, openDB } from 'idb';
import type { Dataset } from '../core/columnar.js';

const DB_NAME = 'serendipity';
const STORE = 'dataset';
const KEY = 'current';
const DB_VERSION = 1;

/**
 * What we persist. Only the columnar `Dataset` is stored — the stats index is a
 * derived, O(N)-rebuildable materialized view, so we recompute it on load rather
 * than serializing its Maps. Structured clone stores the typed-array columns
 * efficiently, so this is a single record, not a row per event.
 */
export interface PersistedDataset {
  dataset: Dataset;
  events: number;
  importedAt: number;
  schemaVersion: number;
}

const SCHEMA_VERSION = 1;

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    },
  });
}

export async function saveDataset(dataset: Dataset, events: number): Promise<void> {
  const record: PersistedDataset = {
    dataset,
    events,
    importedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
  };
  const d = await db();
  await d.put(STORE, record, KEY);
}

export async function loadDataset(): Promise<PersistedDataset | undefined> {
  const d = await db();
  const record = (await d.get(STORE, KEY)) as PersistedDataset | undefined;
  // A schema bump invalidates the stored shape; drop it and re-import.
  if (record && record.schemaVersion !== SCHEMA_VERSION) {
    await d.delete(STORE, KEY);
    return undefined;
  }
  return record;
}

export async function clearDataset(): Promise<void> {
  const d = await db();
  await d.delete(STORE, KEY);
}
