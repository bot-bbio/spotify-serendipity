import { describe, expect, it } from 'vitest';
import { parseTrackUri, retryDelayMs } from './spotify.js';

describe('retryDelayMs (rate-limit backoff)', () => {
  it('honors a numeric Retry-After header (seconds → ms), capped', () => {
    expect(retryDelayMs(0, '2')).toBe(2000);
    expect(retryDelayMs(5, '1')).toBe(1000); // header wins over the exponential term
    expect(retryDelayMs(0, '9999', 500, 20_000)).toBe(20_000); // capped
  });

  it('falls back to capped exponential backoff without a header', () => {
    expect(retryDelayMs(0, null, 500, 20_000)).toBe(500);
    expect(retryDelayMs(1, null, 500, 20_000)).toBe(1000);
    expect(retryDelayMs(2, null, 500, 20_000)).toBe(2000);
    expect(retryDelayMs(10, null, 500, 20_000)).toBe(20_000); // capped
  });

  it('ignores a non-numeric Retry-After and uses backoff', () => {
    expect(retryDelayMs(0, 'soon', 500, 20_000)).toBe(500);
  });
});

describe('parseTrackUri', () => {
  it('extracts the id from a track URI', () => {
    expect(parseTrackUri('spotify:track:6rqhFgbbKwnb9MLmUQDhG6')).toBe('6rqhFgbbKwnb9MLmUQDhG6');
  });

  it('rejects non-track URIs', () => {
    expect(parseTrackUri('spotify:artist:abc')).toBeNull();
    expect(parseTrackUri('spotify:track:bad id!')).toBeNull();
    expect(parseTrackUri('https://open.spotify.com/track/abc')).toBeNull();
  });
});
