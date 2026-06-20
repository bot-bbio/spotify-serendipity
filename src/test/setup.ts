/**
 * Vitest global setup. Pins the process timezone to a fixed offset so the
 * local-time bucketing in `buildIndex` / `thisDayInHistory` (hour-of-day,
 * weekday, day-of-year) is deterministic regardless of the developer's or CI
 * runner's machine timezone.
 *
 * `Etc/GMT+5` is a constant UTC-5 with no daylight-saving shifts (POSIX flips
 * the sign, so `GMT+5` means five hours *behind* UTC), which keeps assertions
 * stable across seasons. It must be set before any `Date` timezone operation,
 * hence a setup file (loaded before every test module) rather than inline code.
 */

// `process` is a Node global only present under the test runner; the app itself
// never touches it (it reads `import.meta.env`), so we declare just this sliver
// locally rather than pulling @types/node into the whole project's typings.
declare const process: { env: Record<string, string | undefined> };

process.env.TZ = 'Etc/GMT+5';

export {};
