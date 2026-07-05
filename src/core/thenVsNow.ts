/**
 * Then vs Now: join the user's *live* top items (Web API `/me/top/…`) against
 * their export-era listening (the local stats index). Works for artists, songs,
 * and albums. Three stories per entity:
 *
 *   still  — big in the export era AND in the live rotation
 *   newEra — in the live rotation but (essentially) absent from the export
 *   lost   — export-era heavyweights that fell out of the live top
 *
 * Items join by normalized name (plus owning artist for songs/albums — the
 * export carries names, not Spotify ids). That errs toward omission on renames
 * and collabs — an item we can't match simply doesn't appear — never toward a
 * wrong claim.
 *
 * "New era" is a *threshold*, not strict absence: any current export contains a
 * stray play or two of almost every artist in the live rotation, so requiring
 * zero plays made the group permanently empty. A handful of plays years ago is
 * still a new era.
 */

/** An entity from the local export with its play magnitude. */
export interface ExportItem {
  name: string;
  /** Owning artist, for songs/albums (part of the join key + shown in the UI). */
  artist?: string;
  /** Qualified plays in the export (the "then" magnitude shown in the UI). */
  plays: number;
}

/** An entity from the live Web API top items. */
export interface LiveItem {
  name: string;
  artist?: string;
  imageUrl?: string;
  url?: string;
}

export interface ThenVsNowItem {
  name: string;
  artist?: string;
  imageUrl?: string;
  url?: string;
  /** Export-era plays, when the item exists in the export. */
  playsThen?: number;
}

export interface ThenVsNowResult {
  still: ThenVsNowItem[];
  newEra: ThenVsNowItem[];
  lost: ThenVsNowItem[];
}

/**
 * Live items with at most this many export plays still count as "new era".
 * Strict zero was the old rule and it starved the group (see module docs).
 */
export const NEW_ERA_MAX_PLAYS = 2;

const norm = (s: string): string => s.trim().toLowerCase();

/** Join key: normalized name, plus normalized artist for songs/albums (NUL-delimited). */
const keyOf = (name: string, artist?: string): string =>
  `${norm(name)}\0${artist === undefined ? '' : norm(artist)}`;

export function computeThenVsNow(
  exportTop: readonly ExportItem[],
  allExport: readonly ExportItem[],
  liveTop: readonly LiveItem[],
  perGroup = 6,
): ThenVsNowResult {
  const topPlays = new Map(exportTop.map((e) => [keyOf(e.name, e.artist), e.plays]));
  const everPlays = new Map(allExport.map((e) => [keyOf(e.name, e.artist), e.plays]));
  const liveKeys = new Set(liveTop.map((l) => keyOf(l.name, l.artist)));

  const still: ThenVsNowItem[] = [];
  const newEra: ThenVsNowItem[] = [];
  for (const l of liveTop) {
    const k = keyOf(l.name, l.artist);
    const playsThen = topPlays.get(k);
    if (playsThen !== undefined) {
      if (still.length < perGroup) {
        still.push({ name: l.name, artist: l.artist, imageUrl: l.imageUrl, url: l.url, playsThen });
      }
    } else if ((everPlays.get(k) ?? 0) <= NEW_ERA_MAX_PLAYS && newEra.length < perGroup) {
      newEra.push({ name: l.name, artist: l.artist, imageUrl: l.imageUrl, url: l.url });
    }
    if (still.length >= perGroup && newEra.length >= perGroup) break;
  }

  const lost: ThenVsNowItem[] = [];
  for (const e of exportTop) {
    if (!liveKeys.has(keyOf(e.name, e.artist))) {
      lost.push({ name: e.name, artist: e.artist, playsThen: e.plays });
    }
    if (lost.length >= perGroup) break;
  }

  return { still, newEra, lost };
}
