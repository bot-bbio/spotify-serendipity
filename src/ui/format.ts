/** Human-friendly formatters for the result card. */

export function hours(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)} min`;
  return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`;
}

export function relTime(epoch: number, now: number = Date.now()): string {
  const days = Math.max(0, (now - epoch) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 45) return `${Math.round(days)} days ago`;
  const months = days / 30.44;
  if (months < 18) return `${Math.round(months)} months ago`;
  return `${(days / 365.25).toFixed(1)} years ago`;
}

/** Turn a `spotify:track:ID` URI into an openable web link. */
export function spotifyUrl(uri?: string): string | undefined {
  if (!uri) return undefined;
  const m = uri.match(/^spotify:(track|artist|album):(.+)$/);
  return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : undefined;
}
