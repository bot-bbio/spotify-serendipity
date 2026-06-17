/// <reference lib="webworker" />
import { encode } from '../core/columnar.js';
import { mergeDedupe } from '../core/dedupe.js';
import { parseExport, type RawExportRecord } from '../core/parser.js';
import type { PlayEvent } from '../types/playevent.js';
import { eventCountError, fileSizeError } from './import-limits.js';
import type { ImportRequest, ImportResponse } from './protocol.js';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const post = (msg: ImportResponse, transfer?: Transferable[]): void => {
  if (transfer) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
};

/**
 * Parse the user's "Extended Streaming History" files into the columnar dataset,
 * off the main thread so the UI never blocks. Files are read one at a time to keep
 * peak memory bounded; the finished column buffers are transferred back zero-copy.
 */
ctx.onmessage = async (e: MessageEvent<ImportRequest>): Promise<void> => {
  try {
    const { files } = e.data;
    const all: PlayEvent[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Guard before reading: reject an oversized file rather than materializing
      // it as a giant string/array and exhausting memory (VULN-004).
      const sizeErr = fileSizeError(file.name, file.size);
      if (sizeErr) {
        post({ type: 'error', message: sizeErr });
        return;
      }
      const json = JSON.parse(await file.text()) as unknown;
      const records: RawExportRecord[] = Array.isArray(json) ? (json as RawExportRecord[]) : [];
      for (const ev of parseExport(records)) all.push(ev);
      const countErr = eventCountError(all.length);
      if (countErr) {
        post({ type: 'error', message: countErr });
        return;
      }
      post({ type: 'progress', done: i + 1, total: files.length });
    }

    const dataset = encode(mergeDedupe(all));
    const c = dataset.columns;
    const transfer: Transferable[] = [
      c.ts.buffer,
      c.msPlayed.buffer,
      c.trackId.buffer,
      c.reasonStart.buffer,
      c.reasonEnd.buffer,
      c.shuffle.buffer,
      c.platform.buffer,
      c.country.buffer,
    ];
    post({ type: 'done', dataset, events: c.n }, transfer);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
