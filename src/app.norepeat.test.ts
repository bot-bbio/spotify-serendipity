// @vitest-environment happy-dom
//
// Regression for the "first Surprise click appears to do nothing" report: with a
// small candidate pool, the weighted draw regularly returned the *same* pick
// twice in a row, which renders as a no-op click. The fix excludes the
// currently-shown result from the draw whenever the pool has an alternative, so
// consecutive picks must always differ.

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

beforeEach(() => mem.clear());

describe('Surprise never redraws the pick already on screen', () => {
  it('12 consecutive clicks each surface a different result than the last', async () => {
    render(h(App, null));
    await tick(); // -> 'empty'
    clickButton(/explore with demo data/i);
    await tick(); // -> 'ready'; default criterion freq-favorite has a pool > 1

    let last: string | null = null;
    for (let i = 0; i < 12; i++) {
      clickButton(/Surprise me/i);
      await tick();
      const label = document.querySelector('.card h2')?.textContent ?? null;
      expect(label).toBeTruthy();
      expect(label).not.toBe(last);
      last = label;
    }
  });
});
