"use client";

import { useCallback, useId, useSyncExternalStore } from "react";
import {
  clearDraft,
  draftKey,
  readDraft,
  subscribeDraft,
  writeDraft,
  type DraftScope,
  type DraftValue,
} from "../lib/draft-store";

const EMPTY: DraftValue = { text: "" };
const serverSnapshot = () => null;

/**
 * THE ONE DRAFT HOOK every message composer uses (`lib/draft-store.ts` says why there is one).
 * Keyed by `scope` (who, which workspace) + `target` (what the text is for). With no signed-in
 * user the text is kept in memory only, under a key private to this mount AND target, and never
 * reaches disk. Two composers on the same key show the same text.
 *
 * ⚠ `useSyncExternalStore` with a `null` SERVER snapshot: the server render and the first client
 * render agree (empty), then the stored draft appears — no hydration mismatch on a controlled
 * textarea.
 */
export function usePersistentDraft(
  scope: DraftScope,
  target: string
): {
  /** The owned storage key (`null` with no user) — what `stashPendingSend` takes. */
  key: string | null;
  value: DraftValue;
  text: string;
  setText: (next: string | ((prev: string) => string)) => void;
  setExtra: (extra: DraftValue["extra"]) => void;
  clear: () => void;
} {
  const mountId = useId();
  const ownedKey = draftKey(scope, target);
  const key = ownedKey ?? `ephemeral|${mountId}|${target}`;
  const subscribe = useCallback((fn: () => void) => subscribeDraft(key, fn), [key]);
  const snapshot = useCallback(() => readDraft(key), [key]);
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot) ?? EMPTY;

  const setText = useCallback(
    (next: string | ((prev: string) => string)) => {
      const prev = readDraft(key) ?? EMPTY;
      const text = typeof next === "function" ? next(prev.text) : next;
      writeDraft(key, { ...prev, text });
    },
    [key]
  );
  const setExtra = useCallback(
    (extra: DraftValue["extra"]) => {
      const prev = readDraft(key) ?? EMPTY;
      writeDraft(key, extra ? { ...prev, extra } : { text: prev.text });
    },
    [key]
  );
  const clear = useCallback(() => clearDraft(key), [key]);

  return { key: ownedKey, value, text: value.text, setText, setExtra, clear };
}
