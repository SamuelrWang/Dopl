"use client";

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import {
  clearDraft,
  draftKey,
  orphanedSends,
  readDraft,
  resolveOrphanedSend,
  subscribeDraft,
  writeDraft,
  type DraftScope,
  type DraftValue,
} from "../lib/draft-store";

const EMPTY: DraftValue = { text: "" };
const serverSnapshot = () => null;
/** Orphaned sends being asked about right now — one question per send, however many mounts. */
const asking = new Set<string>();

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
  target: string,
  /**
   * Did a send a reload interrupted reach the server? `true` ⇒ its words are dropped; `false` or
   * a throw ⇒ they come back. Absent (a composer with no way to ask) ⇒ they come back.
   */
  verifySend?: (sendId: string) => Promise<boolean>
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

  // Latest verifier without re-running the check on every render.
  const verifyRef = useRef(verifySend);
  useEffect(() => {
    verifyRef.current = verifySend;
  }, [verifySend]);
  useEffect(() => {
    for (const orphan of orphanedSends(ownedKey)) {
      if (asking.has(orphan.id)) continue;
      const verify = verifyRef.current;
      if (!verify) {
        resolveOrphanedSend(ownedKey, orphan.id, false);
        continue;
      }
      asking.add(orphan.id);
      verify(orphan.id)
        .then(
          (landed) => resolveOrphanedSend(ownedKey, orphan.id, landed === true),
          () => resolveOrphanedSend(ownedKey, orphan.id, false)
        )
        .finally(() => asking.delete(orphan.id));
    }
  }, [ownedKey]);

  return { key: ownedKey, value, text: value.text, setText, setExtra, clear };
}
