/**
 * Time Capsule orchestration: phrase → sampled tracks → a real private
 * playlist on the user's Spotify account, wearing a generated cover.
 *
 * Order matters for failure honesty: the playlist is only reported as created
 * after the tracks are in it. The cover is deliberately best-effort — the API
 * itself treats it as async (202), and a capsule without custom art is still a
 * capsule, so a cover failure must never fail the save.
 */

import { sampleCapsuleTracks } from '../core/capsule.js';
import { capsuleName } from '../core/naming.js';
import { ENTITY_LABELS, renderPhrase, type QueryDescriptor } from '../core/registry.js';
import type { Engine } from '../core/serendipity.js';
import type { Entity } from '../types/playevent.js';
import {
  addPlaylistItems,
  createPlaylist,
  safeSpotifyUrl,
  uploadPlaylistCover,
} from '../api/spotify.js';
import { renderCoverJpeg } from './cover.js';

/** Tracks per capsule — enough to feel like a playlist, small enough to stay curated. */
const CAPSULE_SIZE = 25;

/** A one-track "playlist" isn't a playlist — below this, refuse to create one. */
export const MIN_CAPSULE_TRACKS = 2;

/** Spotify caps playlist names at 100 characters. */
const MAX_NAME = 100;

export interface CapsuleResult {
  /** open.spotify.com link to the created playlist. */
  url: string;
  name: string;
  trackCount: number;
}

export class CapsuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapsuleError';
  }
}

/** The assembled query as prose — playlist name, cover text, description. */
export function capsuleSentence(
  descriptor: QueryDescriptor,
  entity: Entity,
  param: string | number | undefined,
): string {
  return `${ENTITY_LABELS[entity]} ${renderPhrase(descriptor, param)}`;
}

export async function createTimeCapsule(opts: {
  engine: Engine;
  descriptor: QueryDescriptor;
  entity: Entity;
  param: string | number | undefined;
  rand: () => number;
}): Promise<CapsuleResult> {
  const { engine, descriptor, entity, param, rand } = opts;
  const candidates = descriptor.run(engine, { entity, param });
  const tracks = sampleCapsuleTracks(engine, candidates, CAPSULE_SIZE, rand);
  if (tracks.length === 0) {
    throw new CapsuleError('No matches for this phrase — nothing to put in a playlist.');
  }
  if (tracks.length < MIN_CAPSULE_TRACKS) {
    throw new CapsuleError(
      'Only one track matches this phrase — hit "Surprise me" and play it instead of making a playlist.',
    );
  }

  const sentence = capsuleSentence(descriptor, entity, param);
  const name = capsuleName(descriptor, param).slice(0, MAX_NAME);
  const date = new Date().toISOString().slice(0, 10);
  const description =
    `"${sentence}" — picked from my own listening history by Serendipity on ${date}.`;

  const playlist = await createPlaylist(name, description);
  await addPlaylistItems(playlist.id, tracks.map((t) => t.uri));

  try {
    const cover = await renderCoverJpeg(sentence);
    await uploadPlaylistCover(playlist.id, cover);
  } catch {
    // Best-effort: the playlist exists and is full — ship it without custom art.
  }

  // The API's own link, allowlisted; fall back to the canonical form so the
  // "open the playlist" link never renders an unvetted href (defense in depth).
  const url =
    safeSpotifyUrl(playlist.external_urls.spotify) ??
    `https://open.spotify.com/playlist/${encodeURIComponent(playlist.id)}`;
  return { url, name, trackCount: tracks.length };
}
