import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  MAX_TOTAL_EVENTS,
  eventCountError,
  fileSizeError,
} from './import-limits.js';

describe('import limits (VULN-004)', () => {
  it('accepts a file exactly at the per-file ceiling', () => {
    expect(fileSizeError('history.json', MAX_FILE_BYTES)).toBeNull();
  });

  it('rejects a file over the per-file ceiling with a clear message', () => {
    const msg = fileSizeError('history.json', MAX_FILE_BYTES + 1);
    expect(msg).toMatch(/per-file limit/);
    expect(msg).toContain('history.json');
  });

  it('accepts an event total exactly at the cap', () => {
    expect(eventCountError(MAX_TOTAL_EVENTS)).toBeNull();
  });

  it('rejects an event total over the cap with a clear message', () => {
    expect(eventCountError(MAX_TOTAL_EVENTS + 1)).toMatch(/too large/);
  });
});
