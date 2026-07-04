/**
 * The ♥ button's state: is this track in the user's library, and toggle it.
 * Uses the consolidated `/me/library` endpoints (per CLAUDE.md) with the track
 * URI straight from the export — no id juggling. Optimistic toggle with
 * rollback: the heart flips immediately and reverts if the write fails.
 *
 * `scopeBlocked` turns true when the session predates the library scopes
 * (403 insufficient scope) — the UI offers a reconnect instead of a dead heart.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  checkLibraryContains,
  isInsufficientScope,
  removeFromLibrary,
  saveToLibrary,
} from '../api/spotify.js';

export interface SavedState {
  /** true/false once known; null while unknown (loading, failed, or not applicable). */
  saved: boolean | null;
  scopeBlocked: boolean;
  toggle(): Promise<void>;
}

export function useSaved(connected: boolean, uri: string | undefined): SavedState {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [scopeBlocked, setScopeBlocked] = useState(false);
  // The uri the current `saved` value belongs to — guards both the async check
  // landing after the pick changed, and toggles racing a pick change.
  const uriRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    uriRef.current = uri;
    setSaved(null);
    if (!connected || !uri) return;
    let cancelled = false;
    checkLibraryContains([uri])
      .then((r) => {
        if (!cancelled && uriRef.current === uri) setSaved(r[0] ?? null);
      })
      .catch((e) => {
        if (!cancelled && isInsufficientScope(e)) setScopeBlocked(true);
        // Any other failure: leave `saved` unknown — the heart simply stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [connected, uri]);

  const toggle = useCallback(async (): Promise<void> => {
    const target = uriRef.current;
    if (!target || saved === null) return;
    const next = !saved;
    setSaved(next); // optimistic
    try {
      await (next ? saveToLibrary([target]) : removeFromLibrary([target]));
    } catch (e) {
      if (uriRef.current === target) setSaved(saved); // rollback
      if (isInsufficientScope(e)) setScopeBlocked(true);
    }
  }, [saved]);

  return { saved, scopeBlocked, toggle };
}
