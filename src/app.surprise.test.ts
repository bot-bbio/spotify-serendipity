// @vitest-environment happy-dom
//
// Reproduction for the "two Surprise clicks" bug: after changing the entity
// (Show me …) to album or artist, the *first* Surprise click was reported to
// produce nothing — a second click was needed. This drives entity change then a
// single Surprise click and asserts an outcome (card or no-match) appears at once.

import { h } from 'preact';
import { fireEvent, render } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
});

vi.mock('./db/store.js', () => ({
  loadDataset: vi.fn().mockResolvedValue(null),
  saveDataset: vi.fn().mockResolvedValue(undefined),
  clearDataset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./ui/useEnrichment.js', () => ({ useEnrichment: () => null }));

import { App } from './app.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function clickButton(re: RegExp): void {
  const el = [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
  if (!el) throw new Error(`no button matching ${re}`);
  fireEvent.click(el);
}

function chooseEntity(value: string): void {
  const select = document.querySelector('.lead-row select') as HTMLSelectElement;
  if (!select) throw new Error('no entity select');
  select.value = value;
  fireEvent.change(select);
}

function clickGroup(re: RegExp): void {
  const el = [...document.querySelectorAll('.seg')].find((c) => re.test(c.textContent ?? ''));
  if (!el) throw new Error(`no group tab matching ${re}`);
  fireEvent.click(el as HTMLElement);
}

function clickChip(re: RegExp): void {
  const el = [...document.querySelectorAll('.chip')].find((c) => re.test(c.textContent ?? ''));
  if (!el) throw new Error(`no chip matching ${re}`);
  fireEvent.click(el as HTMLElement);
}

/** The no-match note (a muted <p>), distinct from the always-present footer muted span. */
function noMatchShown(): boolean {
  return [...document.querySelectorAll('p.muted')].some((p) => /no match/i.test(p.textContent ?? ''));
}

/** The kind label of the rendered result card ('artist' | 'album' | 'track'), or null. */
function cardKind(): string | null {
  return document.querySelector('.card .kind')?.textContent ?? null;
}

beforeEach(() => mem.clear());

describe('Surprise produces a result in a single click after switching entity', () => {
  // The default "I play a lot" (freq-favorite) criterion has demo candidates for
  // every entity, so a single click must yield a card — never a no-match note.
  for (const entity of ['artist', 'album', 'track'] as const) {
    it(`shows a result card on the first Surprise click for ${entity}`, async () => {
      render(h(App, null));
      await tick(); // -> 'empty'
      clickButton(/explore with demo data/i);
      await tick(); // -> 'ready'

      chooseEntity(entity);
      await tick();

      clickButton(/Surprise me/i);
      await tick();

      expect(noMatchShown()).toBe(false);
      expect(document.querySelector('.card')).toBeTruthy();
      expect(cardKind()).toBe(entity); // the result must be for the *current* entity
    });
  }

  // The reported path: a track-only criterion is selected, then the entity is
  // switched to album/artist (which forces a criterion reset). The first click
  // must still resolve against the *new* criterion, not the stale track-only one.
  for (const entity of ['album', 'artist'] as const) {
    it(`resolves on the first click after switching from a track-only criterion to ${entity}`, async () => {
      render(h(App, null));
      await tick();
      clickButton(/explore with demo data/i);
      await tick();

      chooseEntity('track');
      await tick();
      clickGroup(/behavior/i); // reveals the track-only criteria
      await tick();
      clickChip(/always skip/i); // a TRACK_ONLY criterion
      await tick();

      chooseEntity(entity); // forces criterion back to the entity's first descriptor
      await tick();

      clickButton(/Surprise me/i);
      await tick();

      expect(document.querySelector('.card')).toBeTruthy();
    });
  }
});
