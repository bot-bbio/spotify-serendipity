// @vitest-environment happy-dom
//
// Regression for the "duplicate app instance" bug: hitting Surprise me and then
// switching Groups was reported to append a second, dead copy of the whole app
// below the live one, accumulating on every interaction. This drives that exact
// path in a real DOM and asserts exactly one app root survives — while also
// asserting each interaction actually took effect, so a no-op can't pass it.

import { h } from 'preact';
import { fireEvent, render } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A minimal in-memory localStorage so the Spotify hook's mount path is inert
// rather than throwing (happy-dom's storage is not wired up here).
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
});

// Avoid IndexedDB on mount; we drive the app via the synchronous demo dataset.
vi.mock('./db/store.js', () => ({
  loadDataset: vi.fn().mockResolvedValue(null),
  saveDataset: vi.fn().mockResolvedValue(undefined),
  clearDataset: vi.fn().mockResolvedValue(undefined),
}));

import { App } from './app.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function clickButton(re: RegExp): void {
  const el = [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
  if (!el) throw new Error(`no button matching ${re}`);
  fireEvent.click(el);
}

function selectedGroup(): string | null {
  const tab = [...document.querySelectorAll('.seg')].find(
    (t) => t.getAttribute('aria-selected') === 'true',
  );
  return tab?.textContent ?? null;
}

function switchToOtherGroup(): void {
  const tab = [...document.querySelectorAll('.seg')].find(
    (t) => t.getAttribute('aria-selected') === 'false',
  );
  if (!tab) throw new Error('expected a second, unselected group tab to switch to');
  fireEvent.click(tab);
}

beforeEach(() => mem.clear());

describe('App duplication regression', () => {
  it('keeps a single app root through repeated Surprise + group switches', async () => {
    render(h(App, null));
    await tick(); // loadDataset() resolves null -> status 'empty'

    clickButton(/explore with demo data/i);
    await tick(); // status 'ready'
    expect(document.querySelectorAll('main.app').length).toBe(1);
    // Preconditions that make the rest of the test meaningful.
    expect(document.querySelectorAll('.seg').length).toBeGreaterThan(1);

    for (let i = 0; i < 4; i++) {
      clickButton(/Surprise me/i);
      await tick();
      // Surprise must have produced a visible outcome (a result card or a no-match note).
      expect(document.querySelector('.card') ?? document.querySelector('.muted')).toBeTruthy();

      const before = selectedGroup();
      switchToOtherGroup();
      await tick();
      expect(selectedGroup()).not.toBe(before); // the group actually changed

      expect(document.querySelectorAll('main.app').length).toBe(1); // …and no copy spawned
    }

    expect(document.querySelectorAll('main.app').length).toBe(1);
    expect(document.querySelectorAll('.surprise').length).toBe(1);
  });
});
