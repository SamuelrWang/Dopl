"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useRefetchOnFocus } from "@/shared/hooks/use-refetch-on-focus";
import { toast } from "@/shared/ui/toast";
import {
  KnowledgeApiError,
  fetchEntry as apiFetchEntry,
  updateEntry as apiUpdateEntry,
} from "../client/api";
import type { KnowledgeEntry } from "../types";
import { DocEditor, SaveStatusIndicator, type SaveStatus } from "./doc-editor";

const AUTOSAVE_DELAY_MS = 1500;

export interface DocPaneProps {
  entry: KnowledgeEntry;
  workspaceId: string;
  /** Called after a successful save — the parent refetches the tree
   *  to pick up updated metadata (title, updated_at). */
  onSaved: () => void;
  /** Optional notification when a 412 conflict is detected. The parent
   *  no longer drives recovery — DocPane handles it locally so unsaved
   *  edits in the editor can never be silently overwritten. */
  onStaleVersion?: () => void;
  /** Called when the tab regains focus AND the editor has no unsaved
   *  edits and is not in a conflict state. Parent should refetch the
   *  tree + the active entry body so the user sees changes another
   *  tab/agent saved while away. */
  onFocusRefetch?: () => void;
}

/**
 * Snapshot of the server's current entry, captured the moment a 412
 * conflict was detected. While this is set:
 *   - autosave is paused (we'd just 412 again),
 *   - a banner above the editor surfaces the conflict and offers
 *     explicit resolution (overwrite server / discard mine and reload),
 *   - the editor stays editable so the user can keep typing while they
 *     decide.
 */
interface ConflictState {
  serverTitle: string;
  serverBody: string;
  serverUpdatedAt: string;
}

/**
 * Document view of a single entry. Title + body are debounce-saved
 * to the API ~1.5s after the user stops typing. Status indicator in
 * the header transitions: idle → dirty → saving → saved → idle.
 *
 * Concurrency model — never overwrite the editor silently:
 *   - Every PATCH carries an `X-Updated-At` precondition.
 *   - On 412, we fetch the server's current state into a local
 *     ConflictState and pause autosave. We DO NOT push the server's
 *     content into the editor — the user's unsaved edits stay intact.
 *     The user explicitly chooses to overwrite the server or to
 *     discard their edits and reload.
 *   - On tab focus while the editor is clean (and no conflict),
 *     `onFocusRefetch` pulls the latest server state.
 *   - Unmount-flush sends one final PUT IF clean OR dirty without a
 *     pending conflict. While in conflict, the user must resolve
 *     explicitly — silent unmount-saves are skipped to avoid
 *     overwriting whatever resolution the user was about to choose.
 *
 * Authoritative content displayed in the editor is owned locally as
 * `editorReloadKey` + DocEditor's `initialMarkdown`. The parent's
 * `entry` prop only reseeds local state on entry switch (parent uses
 * `key={entry.id}` so this is a remount) or on a clean focus refetch
 * — never while the user has unsaved edits.
 */
export function DocPane({
  entry,
  workspaceId,
  onSaved,
  onStaleVersion,
  onFocusRefetch,
}: DocPaneProps) {
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [resolving, setResolving] = useState(false);

  // Authoritative markdown handed to DocEditor. Bumping `editorReloadKey`
  // forces DocEditor to re-seed its Tiptap state with `editorMd` —
  // we ONLY do this on entry switch (remount) and on user-driven
  // "Discard mine, reload". Realtime echo, parent refetches, etc. do
  // NOT touch this.
  const [editorMd, setEditorMd] = useState(entry.body);
  const [editorReloadKey, setEditorReloadKey] = useState(0);

  // Last-saved snapshot — debounced autosave skips when current matches.
  const lastSaved = useRef({ title: entry.title, body: entry.body });
  // The `updated_at` we last observed — `X-Updated-At` precondition.
  const expectedUpdatedAtRef = useRef(entry.updatedAt);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of latest in-memory values for the unmount-flush path so it
  // sees the user's most recent typing even if React state is stale
  // inside the cleanup callback.
  const latestRef = useRef({ title, body });
  useEffect(() => {
    latestRef.current = { title, body };
  });

  // Mirror conflict + status into refs so the unmount-flush callback
  // (empty-deps useEffect) reads the freshest values without re-running
  // the cleanup.
  const conflictRef = useRef<ConflictState | null>(null);
  const statusRef = useRef<SaveStatus>("idle");
  conflictRef.current = conflict;
  statusRef.current = status;

  // Re-seed local state from the parent's `entry` prop ONLY when the
  // editor is in a safe state (no unsaved edits, no pending conflict).
  // Triggered by `onFocusRefetch` paths where the parent refetched a
  // newer body — we sync title/body/baselines so the next save uses
  // the right precondition. Parent uses `key={entry.id}` so the entry
  // switch path remounts entirely; this effect handles in-place
  // refreshes only.
  useEffect(() => {
    if (status === "dirty" || status === "saving" || conflict) return;
    setTitle(entry.title);
    setBody(entry.body);
    setEditorMd(entry.body);
    setEditorReloadKey((k) => k + 1);
    lastSaved.current = { title: entry.title, body: entry.body };
    expectedUpdatedAtRef.current = entry.updatedAt;
  }, [entry.id, entry.title, entry.body, entry.updatedAt, status, conflict]);

  // Tab regained focus AND the editor isn't dirty AND not resolving a
  // conflict — pull the latest.
  useRefetchOnFocus(
    () => {
      onFocusRefetch?.();
    },
    {
      skip: () =>
        status === "dirty" ||
        status === "saving" ||
        conflictRef.current !== null,
    }
  );

  // Cleanup + flush on unmount. Captures values at MOUNT time
  // intentionally — we want a deterministic snapshot of what entry.id /
  // workspaceId we were saving. If there are unsaved edits, fire a
  // final save in the background. Skipped while in conflict — silent
  // background saves while the user is mid-resolution would overwrite
  // whatever choice they were about to make.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      if (conflictRef.current !== null) return;
      const { title: t, body: b } = latestRef.current;
      const last = lastSaved.current;
      if (t === last.title && b === last.body) return;
      const expectedUpdatedAt = expectedUpdatedAtRef.current;
      apiUpdateEntry(
        entry.id,
        { title: t, body: b },
        workspaceId,
        expectedUpdatedAt
      ).catch((err: unknown) => {
        if (err instanceof KnowledgeApiError && err.status === 412) {
          // Concurrent writer beat us. We have no editor to push the
          // resolution UI into — the component is unmounted — so log
          // and drop. The user's local body is gone, but that's the
          // documented behaviour for "navigate away with unsaved edits
          // during a conflict window."
          console.warn(
            "[knowledge] unmount autosave dropped (412 stale)",
            { entryId: entry.id }
          );
          return;
        }
      });
    };
    // entry.id and workspaceId are stable (parent uses key=entry.id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Capture a fresh snapshot of the server's entry into local conflict
   * state. Pauses autosave, surfaces the banner. Does NOT touch the
   * editor's content.
   */
  const enterConflict = useCallback(async (): Promise<boolean> => {
    try {
      const fresh = await apiFetchEntry(entry.id, workspaceId);
      setConflict({
        serverTitle: fresh.title,
        serverBody: fresh.body,
        serverUpdatedAt: fresh.updatedAt,
      });
      onStaleVersion?.();
      return true;
    } catch (err) {
      reportError(err, "Couldn't load the latest server version");
      setStatus("error");
      return false;
    }
  }, [entry.id, workspaceId, onStaleVersion]);

  const scheduleSave = useCallback(
    (nextTitle: string, nextBody: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // While resolving a conflict the user MAY keep typing; surface
      // dirty so the indicator stays correct, but do not schedule a
      // network round-trip that would 412 again.
      setStatus("dirty");
      if (conflictRef.current !== null) return;
      timerRef.current = setTimeout(async () => {
        if (
          nextTitle === lastSaved.current.title &&
          nextBody === lastSaved.current.body
        ) {
          setStatus("idle");
          return;
        }
        setStatus("saving");
        try {
          const saved = await apiUpdateEntry(
            entry.id,
            { title: nextTitle, body: nextBody },
            workspaceId,
            expectedUpdatedAtRef.current
          );
          lastSaved.current = { title: nextTitle, body: nextBody };
          expectedUpdatedAtRef.current = saved.updatedAt;
          setStatus("saved");
          onSaved();
          if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
          resetTimerRef.current = setTimeout(() => {
            setStatus((prev) => (prev === "saved" ? "idle" : prev));
          }, 2000);
        } catch (err) {
          if (err instanceof KnowledgeApiError && err.status === 412) {
            await enterConflict();
            return;
          }
          setStatus("error");
          reportError(err, "Couldn't save entry");
        }
      }, AUTOSAVE_DELAY_MS);
    },
    [entry.id, workspaceId, onSaved, enterConflict]
  );

  /**
   * Conflict resolution: keep the user's local edits, overwrite the
   * server's version. Uses the conflict's serverUpdatedAt as the
   * precondition so we win on top of the freshest known server state.
   * If yet another writer slipped in between fetch and PATCH, we
   * 412 again and re-enter conflict — never silently overwrite a newer
   * unseen version.
   */
  const handleKeepMine = useCallback(async () => {
    if (!conflict) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setResolving(true);
    setStatus("saving");
    try {
      const saved = await apiUpdateEntry(
        entry.id,
        { title, body },
        workspaceId,
        conflict.serverUpdatedAt
      );
      lastSaved.current = { title, body };
      expectedUpdatedAtRef.current = saved.updatedAt;
      setConflict(null);
      setStatus("saved");
      onSaved();
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        setStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 2000);
    } catch (err) {
      if (err instanceof KnowledgeApiError && err.status === 412) {
        await enterConflict();
        setStatus("dirty");
        return;
      }
      setStatus("error");
      reportError(err, "Couldn't save entry");
    } finally {
      setResolving(false);
    }
  }, [conflict, title, body, entry.id, workspaceId, onSaved, enterConflict]);

  /**
   * Conflict resolution: discard the user's local edits, reload the
   * server's version into the editor. The user explicitly chose this,
   * so cursor/content jump is expected.
   */
  const handleDiscardMine = useCallback(() => {
    if (!conflict) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setTitle(conflict.serverTitle);
    setBody(conflict.serverBody);
    setEditorMd(conflict.serverBody);
    setEditorReloadKey((k) => k + 1);
    lastSaved.current = {
      title: conflict.serverTitle,
      body: conflict.serverBody,
    };
    expectedUpdatedAtRef.current = conflict.serverUpdatedAt;
    setConflict(null);
    setStatus("idle");
  }, [conflict]);

  return (
    <article className="flex flex-col">
      {conflict && (
        <ConflictBanner
          resolving={resolving}
          onKeepMine={handleKeepMine}
          onDiscardMine={handleDiscardMine}
        />
      )}
      <div className="max-w-3xl px-6 pt-7 pb-3 flex items-center gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => {
            const next = e.target.value;
            setTitle(next);
            scheduleSave(next, body);
          }}
          placeholder="Untitled"
          className="flex-1 bg-transparent text-[20px] font-semibold text-text-primary tracking-tight focus:outline-none placeholder:text-text-secondary/40"
        />
        <SaveStatusIndicator state={status} />
      </div>
      <DocEditor
        initialMarkdown={editorMd}
        resetKey={`${entry.id}:${editorReloadKey}`}
        onChange={(md) => {
          setBody(md);
          scheduleSave(title, md);
        }}
      />
    </article>
  );
}

function ConflictBanner({
  resolving,
  onKeepMine,
  onDiscardMine,
}: {
  resolving: boolean;
  onKeepMine: () => void;
  onDiscardMine: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-y border-amber-500/20 bg-amber-500/[0.06] px-6 py-3 flex flex-wrap items-center gap-3"
    >
      <AlertTriangle size={14} className="shrink-0 text-amber-300/90" />
      <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-amber-100/90">
        <strong className="font-semibold">Edited elsewhere.</strong> The server
        has a newer version of this entry. Choose how to resolve — your edits
        are preserved until you do.
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiscardMine}
          disabled={resolving}
          className="rounded-md border border-white/[0.1] bg-white/[0.02] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white/95 disabled:opacity-40"
        >
          Discard mine, reload
        </button>
        <button
          type="button"
          onClick={onKeepMine}
          disabled={resolving}
          className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-100/95 transition-colors hover:bg-amber-400/15 disabled:opacity-40"
        >
          {resolving ? "Saving…" : "Save mine, overwrite"}
        </button>
      </div>
    </div>
  );
}

function reportError(err: unknown, fallback: string): void {
  if (err instanceof KnowledgeApiError) {
    toast({ title: fallback, description: err.message });
    return;
  }
  toast({
    title: fallback,
    description: err instanceof Error ? err.message : "Unknown error",
  });
}
