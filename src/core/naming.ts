/**
 * Playlist naming schema for Time Capsules: every criterion gets an evocative,
 * *specific* title instead of the generic "Serendipity · <sentence>" — e.g. the
 * "from this day in past years" phrase exports as "Throwbacks from July 4".
 *
 * Titles carry the parameter when there is one (year, date, duration, weekday…)
 * so two capsules made with different blanks never collide on name. The full
 * assembled sentence still ships in the playlist *description*, so nothing is
 * lost by keeping titles short.
 */

import { DURATION_CHOICES, renderPhrase, type ParamValue, type QueryDescriptor } from './registry.js';

/** "July 4" — used for day-of-year titles (local calendar, like the criterion). */
export function monthDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/** "June 15, 2023" from a 'YYYY-MM-DD' param (UTC, matching how dates are queried). */
export function longDate(iso: string): string {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The duration label for a `{duration}` param value ("365" → "a year"). */
function durationLabel(param: ParamValue | undefined): string {
  const raw = String(param ?? '365');
  return DURATION_CHOICES.find((c) => c.value === raw)?.label ?? `${raw} days`;
}

/** "a month" → "month", "three months" → "three months" (for "past …" phrasing). */
function durationNoun(param: ParamValue | undefined): string {
  return durationLabel(param).replace(/^a /, '');
}

/** The label of the selected `choice` param ("1" → "Mondays"). */
function choiceLabel(d: QueryDescriptor, param: ParamValue | undefined): string {
  const raw = String(param ?? d.choices?.[0]?.value ?? '');
  return d.choices?.find((c) => c.value === raw)?.label ?? raw;
}

const DAYPART_NAMES: Record<string, string> = {
  morning: 'Morning soundtrack',
  afternoon: 'Afternoon soundtrack',
  evening: 'Evening soundtrack',
  'late-night': 'Late-night soundtrack',
};

const SEASON_NAMES: Record<string, string> = {
  winter: 'Winter soundtrack',
  spring: 'Spring soundtrack',
  summer: 'Summer soundtrack',
  autumn: 'Autumn soundtrack',
};

const PLATFORM_NAMES: Record<string, string> = {
  phone: 'Phone favorites',
  computer: 'Desktop favorites',
  web: 'Web player favorites',
  tv: 'Big-screen favorites',
};

/**
 * The exported playlist's title for the assembled phrase. `now` is injectable
 * for tests; it only matters for the day-of-year criterion.
 */
export function capsuleName(
  descriptor: QueryDescriptor,
  param: ParamValue | undefined,
  now: Date = new Date(),
): string {
  switch (descriptor.id) {
    // --- Frequency
    case 'freq-obsessed':
      return 'Constant rotation';
    case 'freq-favorite':
      return 'Heavy rotation';
    case 'freq-regular':
      return 'Steady rotation';
    case 'freq-occasional':
      return 'Now & then';
    case 'freq-rare':
      return 'Forgotten favorites';
    case 'top-year':
      return `Heavy rotation, ${String(param ?? now.getUTCFullYear())}`;
    // --- Recency
    case 'dormant':
      return `Untouched for ${durationLabel(param)}`;
    case 'new-find':
      return `Fresh finds — past ${durationNoun(param)}`;
    case 'binge':
      return 'Binged & dropped';
    case 'comeback':
      return 'Comebacks';
    // --- Date
    case 'on-date':
      return `Time capsule — ${longDate(String(param ?? ''))}`;
    case 'this-day':
      return `Throwbacks from ${monthDay(now)}`;
    case 'from-year':
      return `Back in ${String(param ?? now.getUTCFullYear())}`;
    case 'first':
      return 'Earliest discoveries';
    case 'discovered-on':
      return `Discovered ${longDate(String(param ?? ''))}`;
    // --- Pattern
    case 'daypart':
      return DAYPART_NAMES[String(param)] ?? 'Daypart soundtrack';
    case 'weekday':
      return `Made for ${choiceLabel(descriptor, param)}`;
    case 'season':
      return SEASON_NAMES[String(param)] ?? 'Seasonal soundtrack';
    case 'mileage':
      return 'Most hours logged';
    // --- Context
    case 'platform':
      return PLATFORM_NAMES[String(param)] ?? 'Device favorites';
    case 'traveling':
      return 'Travel soundtrack';
    // --- Behavior
    case 'skip':
      return 'The skip list';
    case 'finish':
      return 'Played to the end';
    case 'repeat':
      return 'On repeat';
    case 'deep-cut':
      return 'Deep cuts';
    case 'one-hit':
      return 'One-hit wonders';
    // A criterion added without a title falls back to the old generic form.
    default:
      return `Serendipity · ${renderPhrase(descriptor, param)}`;
  }
}
