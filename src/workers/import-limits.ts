/**
 * Import guardrails (VULN-004).
 *
 * The file import is the one untrusted input in Phase 1. `JSON.parse(file.text())`
 * materializes each file as a whole string and then a JS array, so an accidental or
 * hostile multi-GB file would OOM the worker/tab before any of our logic runs. These
 * ceilings reject such inputs up front with a clear, user-facing message instead.
 *
 * They sit far above any real Spotify "Extended Streaming History" export — a heavy
 * decade-long history is a few hundred thousand plays spread over a handful of files
 * that are each well under 50 MB.
 */

/** Largest single file we will read. A few hundred MB; real exports are << this. */
export const MAX_FILE_BYTES = 300 * 1024 * 1024;

/** Largest total play count we will ingest. ~5–10× the heaviest realistic history. */
export const MAX_TOTAL_EVENTS = 2_000_000;

const mb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Returns a user-facing error message if a single file is too large to accept,
 * or `null` if it is within the limit.
 */
export function fileSizeError(name: string, size: number): string | null {
  if (size <= MAX_FILE_BYTES) return null;
  return (
    `"${name}" is ${mb(size)}, over the ${mb(MAX_FILE_BYTES)} per-file limit. ` +
    `Spotify history files are far smaller — this does not look like an export.`
  );
}

/**
 * Returns a user-facing error message if the running event total has exceeded the
 * cap, or `null` if it is still within the limit.
 */
export function eventCountError(total: number): string | null {
  if (total <= MAX_TOTAL_EVENTS) return null;
  return (
    `Import exceeds ${MAX_TOTAL_EVENTS.toLocaleString()} plays — too large to ` +
    `process in the browser. Try importing fewer files at once.`
  );
}
