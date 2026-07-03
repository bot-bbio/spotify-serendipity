/** Human-friendly formatters for the result card. */

export function hours(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)} min`;
  return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`;
}

export function relTime(epoch: number, now: number = Date.now()): string {
  const days = Math.max(0, (now - epoch) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 45) return plural(Math.round(days), 'day');
  const months = days / 30.44;
  if (months < 18) return plural(Math.round(months), 'month');
  return `${(days / 365.25).toFixed(1)} years ago`;
}

/** "1 day ago" / "3 days ago" — rounded counts need the singular form too. */
function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** Milliseconds as `m:ss` for the player scrubber, e.g. 75_000 → "1:15". */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Turn a `spotify:track:ID` URI into an openable web link. */
export function spotifyUrl(uri?: string): string | undefined {
  if (!uri) return undefined;
  const m = uri.match(/^spotify:(track|artist|album):(.+)$/);
  return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : undefined;
}
