"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/shared/ui/toast";
import type { SaveStatus } from "@/shared/editor/doc-editor";
import type { SkillFile } from "@/features/skills/types";
import { SkillApiError, writeSkillBody } from "@/features/skills/client/api";
import { errMessage } from "../components/skill-view-utils";
import type { SkillConflict } from "./use-skill-conflict";

const AUTOSAVE_DELAY_MS = 1500;

interface Params {
  slug: string;
  workspaceId: string;
  /** `body_updated_at` of the body first rendered — the first precondition. */
  initialUpdatedAt: string;
  /** Reads the live conflict record (`useSkillConflict`). Autosave pauses
   *  while it is set, and a forced overwrite takes its precondition from it.
   *  Must be identity-stable: the unmount flush below depends on it. */
  peekConflict: () => SkillConflict | null;
  /** Pull + record the server's body after a 412. Null = the pull failed. */
  captureConflict: () => Promise<SkillConflict | null>;
  /** A debounced autosave landed. */
  onAutosaved: (file: SkillFile, skillUpdatedAt: string) => void;
  /** A forced overwrite ("Save mine") landed. */
  onOverwritten: (file: SkillFile, skillUpdatedAt: string) => void;
}

/**
 * Every write to a skill's BODY, serialized.
 *
 * Two saves must never be in flight together: the second would carry a
 * stale baseline and 412 against our own write — the "someone else is
 * editing" banner with only one editor in the room. So the debounced
 * autosave, the unmount flush and the conflict overwrite all queue on one
 * promise chain, and the optimistic-concurrency baseline moves only on the
 * chain.
 *
 * The caller owns the skill's METADATA clock (a separate `updated_at`); the
 * `skillUpdatedAt` handed to `onAutosaved` / `onOverwritten` is what keeps it
 * current after a body write (F-038 D10).
 */
export function useSkillSaveChain({
  slug,
  workspaceId,
  initialUpdatedAt,
  peekConflict,
  captureConflict,
  onAutosaved,
  onOverwritten,
}: Params) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Debounce timer + pending-body cache. Held in refs so the unmount
  // cleanup can flush the in-flight edit without stale React state.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBodyRef = useRef<string | null>(null);
  // Baseline `updatedAt` for the optimistic-concurrency precondition;
  // updated on every successful save.
  const baselineRef = useRef(initialUpdatedAt);
  const slugRef = useRef(slug);
  const saveStatusRef = useRef<SaveStatus>(saveStatus);
  useEffect(() => {
    slugRef.current = slug;
    saveStatusRef.current = saveStatus;
  }, [slug, saveStatus]);

  // Latest-ref for the callbacks. The save jobs must stay identity-stable —
  // if they changed with every render the unmount-flush effect below would
  // tear down and re-run on every keystroke.
  const handlersRef = useRef({ captureConflict, onAutosaved, onOverwritten });
  useEffect(() => {
    handlersRef.current = { captureConflict, onAutosaved, onOverwritten };
  });

  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueSave = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = saveChainRef.current.then(job, job);
    // Park a swallowed tail so an unawaited failing job can't surface as
    // an unhandled rejection; callers that await `next` still see it.
    saveChainRef.current = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }, []);

  const markSaved = useCallback(() => {
    setSaveStatus("saved");
    setTimeout(() => {
      setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
    }, 1800);
  }, []);

  const flushSave = useCallback(
    () =>
      enqueueSave(async () => {
        // Don't fire while in conflict — autosave would just 412 again.
        if (peekConflict()) return;
        const body = pendingBodyRef.current;
        if (body === null) return;
        pendingBodyRef.current = null;
        setSaveStatus("saving");
        try {
          const { file, skillUpdatedAt } = await writeSkillBody(
            slugRef.current,
            body,
            workspaceId,
            baselineRef.current
          );
          baselineRef.current = file.updatedAt;
          handlersRef.current.onAutosaved(file, skillUpdatedAt);
          markSaved();
        } catch (err) {
          if (err instanceof SkillApiError && err.status === 412) {
            // Re-buffer the losing body ONLY if nothing newer was typed
            // while the PUT was in flight — never stomp fresher keystrokes
            // with an older snapshot.
            if (pendingBodyRef.current === null) pendingBodyRef.current = body;
            const fresh = await handlersRef.current.captureConflict();
            if (fresh) {
              baselineRef.current = fresh.serverUpdatedAt;
            } else {
              toast({
                title: "Edited elsewhere",
                description:
                  "Couldn't load the latest server version — please refresh.",
              });
            }
            setSaveStatus("error");
            return;
          }
          setSaveStatus("error");
          toast({ title: "Couldn't save", description: errMessage(err) });
        }
      }),
    [enqueueSave, markSaved, peekConflict, workspaceId]
  );

  const scheduleSave = useCallback(
    (body: string) => {
      pendingBodyRef.current = body;
      setSaveStatus("dirty");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flushSave();
      }, AUTOSAVE_DELAY_MS);
    },
    [flushSave]
  );

  // Cleanup any pending timer on unmount, then flush the last edit
  // through the save chain (so it runs AFTER any in-flight save and
  // carries a fresh baseline). A 412 here has no editor left to show a
  // banner in — surface a toast instead of dropping silently. Skipped
  // mid-conflict.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (peekConflict()) return;
      if (pendingBodyRef.current === null) return;
      void enqueueSave(async () => {
        const body = pendingBodyRef.current;
        if (body === null) return;
        pendingBodyRef.current = null;
        try {
          await writeSkillBody(slugRef.current, body, workspaceId, baselineRef.current);
        } catch (err) {
          if (err instanceof SkillApiError && err.status === 412) {
            toast({
              title: "Last edit not saved",
              description:
                "This skill was edited elsewhere while you navigated away — reopen it to reconcile.",
            });
          }
        }
      });
    };
  }, [enqueueSave, peekConflict, workspaceId]);

  /**
   * Conflict resolution "Save mine": keep the local edits and force-save
   * over the server using the conflict snapshot's precondition. Another
   * racing writer re-triggers the conflict — never silently overwrite.
   */
  const saveOverriding = useCallback(
    () =>
      enqueueSave(async () => {
        const c = peekConflict();
        if (!c) return;
        const body = pendingBodyRef.current;
        if (body === null) return;
        setSaveStatus("saving");
        try {
          const { file, skillUpdatedAt } = await writeSkillBody(
            slugRef.current,
            body,
            workspaceId,
            c.serverUpdatedAt
          );
          baselineRef.current = file.updatedAt;
          pendingBodyRef.current = null;
          handlersRef.current.onOverwritten(file, skillUpdatedAt);
          markSaved();
        } catch (err) {
          if (err instanceof SkillApiError && err.status === 412) {
            // A failed re-pull is a network blip — leave the existing
            // conflict snapshot in place so the user can retry.
            const fresh = await handlersRef.current.captureConflict();
            if (fresh) baselineRef.current = fresh.serverUpdatedAt;
            setSaveStatus("error");
            return;
          }
          setSaveStatus("error");
          toast({ title: "Couldn't save", description: errMessage(err) });
        }
      }),
    [enqueueSave, markSaved, peekConflict, workspaceId]
  );

  /**
   * Drop the buffered autosave AND its timer. The delete flow must call this
   * before the DELETE: otherwise the unmount flush above PUTs the body into a
   * row that no longer exists.
   */
  const cancelPendingSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingBodyRef.current = null;
  }, []);

  /**
   * Conflict resolution "Discard mine": drop the buffered body and adopt the
   * server's clock. The timer is deliberately left alone — it fires into an
   * empty buffer and no-ops, and clearing it would let a focus/realtime pull
   * land earlier than it does today.
   */
  const discardPending = useCallback((serverUpdatedAt: string) => {
    pendingBodyRef.current = null;
    baselineRef.current = serverUpdatedAt;
    setSaveStatus("idle");
  }, []);

  /** Adopt a server pull's `body_updated_at` as the next precondition. */
  const adoptBaseline = useCallback((bodyUpdatedAt: string) => {
    baselineRef.current = bodyUpdatedAt;
  }, []);

  const isAtRest = useCallback(
    () =>
      timerRef.current === null &&
      pendingBodyRef.current === null &&
      saveStatusRef.current !== "saving" &&
      peekConflict() === null,
    [peekConflict]
  );

  /** A debounce is armed or a body is buffered — a pull would clobber it. */
  const hasPendingEdit = useCallback(
    () => timerRef.current !== null || pendingBodyRef.current !== null,
    []
  );

  return {
    saveStatus,
    scheduleSave,
    saveOverriding,
    cancelPendingSave,
    discardPending,
    adoptBaseline,
    isAtRest,
    hasPendingEdit,
  };
}
