import type { Dataset } from '../core/columnar.js';

/** Main thread → worker: the export JSON files to ingest. */
export interface ImportRequest {
  files: File[];
}

/** Worker → main thread. The `done` message transfers the column buffers. */
export type ImportResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; dataset: Dataset; events: number }
  | { type: 'error'; message: string };
