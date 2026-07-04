/**
 * Then vs Now: join the user's *live* top artists (Web API `/me/top/artists`)
 * against their export-era listening (the local stats index). Three stories:
 *
 *   still  — big in the export era AND in the live rotation
 *   newEra — in the live rotation but absent from the entire export
 *   lost   — export-era heavyweights that fell out of the live top
 *
 * Artists join by normalized name (the export carries names, not artist ids).
 * That errs toward omission on renames/collabs — an artist we can't match
 * simply doesn't appear — never toward a wrong claim.
 */

export interface ExportArtist {
  name: string;
  /** Qualified plays in the export (the "then" magnitude shown in the UI). */
  plays: number;
}

export interface LiveArtist {
  name: string;
  imageUrl?: string;
  url?: string;
}

export interface ThenVsNowItem {
  name: string;
  imageUrl?: string;
  url?: string;
  /** Export-era plays, when the artist exists in the export. */
  playsThen?: number;
}

export interface ThenVsNowResult {
  still: ThenVsNowItem[];
  newEra: ThenVsNowItem[];
  lost: ThenVsNowItem[];
}

const norm = (name: string): string => name.trim().toLowerCase();

export function computeThenVsNow(
  exportTop: readonly ExportArtist[],
  allExportNames: Iterable<string>,
  liveTop: readonly LiveArtist[],
  perGroup = 6,
): ThenVsNowResult {
  const playsByName = new Map(exportTop.map((a) => [norm(a.name), a.plays]));
  const everPlayed = new Set([...allExportNames].map(norm));
  const liveNames = new Set(liveTop.map((a) => norm(a.name)));

  const still: ThenVsNowItem[] = [];
  const newEra: ThenVsNowItem[] = [];
  for (const a of liveTop) {
    const playsThen = playsByName.get(norm(a.name));
    if (playsThen !== undefined) {
      still.push({ name: a.name, imageUrl: a.imageUrl, url: a.url, playsThen });
    } else if (!everPlayed.has(norm(a.name))) {
      newEra.push({ name: a.name, imageUrl: a.imageUrl, url: a.url });
    }
    if (still.length >= perGroup && newEra.length >= perGroup) break;
  }

  const lost: ThenVsNowItem[] = [];
  for (const a of exportTop) {
    if (!liveNames.has(norm(a.name))) lost.push({ name: a.name, playsThen: a.plays });
    if (lost.length >= perGroup) break;
  }

  return { still: still.slice(0, perGroup), newEra: newEra.slice(0, perGroup), lost };
}
