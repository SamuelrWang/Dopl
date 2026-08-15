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
 * ⚠ Two saves must never be in flight together: the second carries a stale
 * baseline and 412s against our own write — "someone else is editing" with
 * one editor in the room. Debounced autosave, unmount flush and conflict
 * overwrite all queue on one promise chain, and the CAS baseline moves only
 * on that chain.
 *
 * Caller owns the skill's METADATA clock (a separate `updated_at`);
 * `skillUpdatedAt` on `onAutosaved` / `onOverwritten` keeps it current.
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

  // Refs, not state, so the unmount cleanup can flush the in-flight edit
  // without reading stale React state.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBodyRef = useRef<string | null>(null);
  // CAS precondition; moves on every successful save.
  const baselineRef = useRef(initialUpdatedAt);
  const slugRef = useRef(slug);
  const saveStatusRef = useRef<SaveStatus>(saveStatus);
  useEffect(() => {
    slugRef.current = slug;
    saveStatusRef.current = saveStatus;
  }, [slug, saveStatus]);

  // ⚠ Latest-ref: save jobs must stay identity-stable, or the unmount-flush
  // effect below tears down and re-runs on every keystroke.
  const handlersRef = useRef({ captureConflict, onAutosaved, onOverwritten });
  useEffect(() => {
    handlersRef.current = { captureConflict, onAutosaved, onOverwritten };
  });

  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueSave = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = saveChainRef.current.then(job, job);
    // Swallowed tail: an unawaited failing job must not become an unhandled
    // rejection. Callers awaiting `next` still see it.
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
            // ⚠ Re-buffer the losing body ONLY if nothing newer was typed
            // mid-PUT — never stomp fresher keystrokes with an older snapshot.
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

  // Unmount: clear the timer, then flush the last edit THROUGH the chain so
  // it runs after any in-flight save with a fresh baseline. A 412 here has no
  // editor left for a banner — toast instead of dropping silently. Skipped
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

  /** "Save mine": force-save local edits using the conflict snapshot's
   *  precondition. Another racing writer re-triggers the conflict — never
   *  silently overwrite. */
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
            // Failed re-pull = network blip. Leave the existing conflict
            // snapshot in place so the user can retry.
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

  /** Drop the buffered autosave AND its timer. ⚠ Delete flow must call this
   *  BEFORE the DELETE, or the unmount flush PUTs into a deleted row. */
  const cancelPendingSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingBodyRef.current = null;
  }, []);

  /** "Discard mine": drop the buffered body, adopt the server clock. ⚠ Timer
   *  deliberately left alone — it fires into an empty buffer and no-ops;
   *  clearing it would let a focus/realtime pull land earlier. */
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
