"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRefetchOnFocus } from "@/shared/hooks/use-refetch-on-focus";
import { useCurrentProfile } from "@/shared/auth/use-current-profile";
import { usePresence } from "@/shared/realtime/use-presence";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import {
  KnowledgeApiError,
  fetchEntry as apiFetchEntry,
  updateEntry as apiUpdateEntry,
} from "../client/api";
import { DESCRIPTION_MAX } from "@/config";
import type { KnowledgeEntry } from "../types";
import { toast } from "@/shared/ui/toast";
import { DocEditor, SaveStatusIndicator, type SaveStatus } from "@/shared/editor/doc-editor";
import { ConflictBanner, reportError } from "./doc-pane-chrome";

const AUTOSAVE_DELAY_MS = 1500;

export interface DocPaneProps {
  /** MUST be the full entry (body + fresh `updated_at`) — never the
   *  body-stripped tree entry, or the first autosave writes `body: ""`
   *  over the document. EntryView gates on the per-entry fetch. */
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
  /** Horizontal inset (Tailwind classes) for the editor's fixed toolbar
   *  pill, so it centers over the host panel. Defaults to the v1 layout. */
  toolbarInset?: string;
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
  toolbarInset,
}: DocPaneProps) {
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [resolving, setResolving] = useState(false);
  // Agent-facing description (the entry's `excerpt` column). Saved on
  // blur — independently of the title/body autosave, but through the
  // same updated_at precondition so a description save can't make the
  // next body autosave 412.
  const [description, setDescription] = useState(entry.excerpt ?? "");
  const lastSavedDescription = useRef(entry.excerpt ?? "");

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

  // Presence: who else has this entry open, and whether they're editing.
  const selfProfile = useCurrentProfile();
  const presencePeers = usePresence(
    `presence:kb-entry:${entry.id}`,
    selfProfile,
    status === "dirty" || status === "saving"
  );
  const otherEditors = presencePeers.filter(
    (p) => p.userId !== selfProfile?.userId
  );

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
    setDescription(entry.excerpt ?? "");
    lastSaved.current = { title: entry.title, body: entry.body };
    lastSavedDescription.current = entry.excerpt ?? "";
    expectedUpdatedAtRef.current = entry.updatedAt;
  }, [entry.id, entry.title, entry.body, entry.excerpt, entry.updatedAt, status, conflict]);

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
      // Through the save chain so this runs AFTER any in-flight save and
      // reads the token that save produced — not a stale one.
      void enqueueSave(async () => {
        try {
          await apiUpdateEntry(
            entry.id,
            { title: t, body: b },
            workspaceId,
            expectedUpdatedAtRef.current
          );
        } catch (err) {
          if (err instanceof KnowledgeApiError && err.status === 412) {
            // Concurrent writer beat us and the editor is unmounted —
            // there's nowhere to run the resolution UI. Tell the user
            // instead of dropping the edit silently.
            toast({
              title: "Last edit not saved",
              description: `"${t || "Untitled"}" was edited elsewhere while you navigated away — reopen it to reconcile.`,
            });
          }
        }
      });
    };
    // entry.id and workspaceId are stable (parent uses key=entry.id);
    // enqueueSave is a stable useCallback.
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

  // Serialize every PATCH through one chain so two saves can never be in
  // flight together. Body autosave, description blur, and conflict
  // resolution all share the one `updated_at` token — an overlapping
  // pair would 412 against our own write (a phantom "edited elsewhere"
  // with a single editor in the room).
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

  const scheduleSave = useCallback(
    (nextTitle: string, nextBody: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // While resolving a conflict the user MAY keep typing; surface
      // dirty so the indicator stays correct, but do not schedule a
      // network round-trip that would 412 again.
      setStatus("dirty");
      if (conflictRef.current !== null) return;
      timerRef.current = setTimeout(() => {
        void enqueueSave(async () => {
          // Re-check inside the chain — a queued-behind save may have
          // entered conflict or already written this exact content.
          if (conflictRef.current !== null) return;
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
        });
      }, AUTOSAVE_DELAY_MS);
    },
    [entry.id, workspaceId, onSaved, enterConflict, enqueueSave]
  );

  /** Save the agent-facing description on blur (no-op when unchanged). */
  const handleDescriptionBlur = useCallback(() => {
    const next = description.trim();
    if (next === lastSavedDescription.current.trim()) return;
    void enqueueSave(async () => {
      if (conflictRef.current !== null) return;
      try {
        const saved = await apiUpdateEntry(
          entry.id,
          { excerpt: next === "" ? null : next },
          workspaceId,
          expectedUpdatedAtRef.current
        );
        lastSavedDescription.current = next;
        expectedUpdatedAtRef.current = saved.updatedAt;
        onSaved();
      } catch (err) {
        if (err instanceof KnowledgeApiError && err.status === 412) {
          await enterConflict();
          return;
        }
        reportError(err, "Couldn't save description");
      }
    });
  }, [description, entry.id, workspaceId, onSaved, enterConflict, enqueueSave]);

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
      const saved = await enqueueSave(() =>
        apiUpdateEntry(
          entry.id,
          { title, body },
          workspaceId,
          conflict.serverUpdatedAt
        )
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
  }, [conflict, title, body, entry.id, workspaceId, onSaved, enterConflict, enqueueSave]);

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
      {/* Floating header panel — the single place the file's name shows,
          plus the agent-facing description (entry `excerpt`) that streams
          to MCP clients in tree / directory listings. Framed like the
          study-notes intro panel: uppercase label strip over an inset body. */}
      <div className="mx-auto mt-4 mb-1 w-[calc(100%-3rem)] max-w-3xl overflow-hidden rounded-[14px] border border-border-strong">
        <div className="flex items-center gap-3 bg-card-surface-subtle px-4 py-1.5">
          <span className="flex-1 text-label font-semibold uppercase tracking-wide text-text-secondary">
            Overview
          </span>
          <AvatarStack users={otherEditors} />
          <SaveStatusIndicator state={status} />
        </div>
        <div className="border-t border-border-subtle bg-bg-inset px-4 pt-2.5 pb-2">
          <input
            type="text"
            value={title}
            onChange={(e) => {
              const next = e.target.value;
              setTitle(next);
              scheduleSave(next, body);
            }}
            placeholder="Untitled"
            className="w-full min-w-0 bg-transparent text-display font-semibold leading-snug tracking-tight text-text-primary focus:outline-none placeholder:text-text-muted"
          />
          <div className="mt-1 flex items-end gap-2">
            <textarea
              value={description}
              onChange={(e) =>
                setDescription(e.target.value.slice(0, DESCRIPTION_MAX))
              }
              onBlur={handleDescriptionBlur}
              rows={2}
              maxLength={DESCRIPTION_MAX}
              aria-label="Description for agents"
              placeholder="Add a short description — agents see this when browsing the tree, before opening the file…"
              className="flex-1 min-w-0 resize-none bg-transparent text-body leading-relaxed text-text-secondary placeholder:text-text-muted focus:outline-none"
            />
            <span className="shrink-0 pb-0.5 font-mono text-micro text-text-muted">
              {description.length}/{DESCRIPTION_MAX}
            </span>
          </div>
        </div>
      </div>
      <DocEditor
        initialMarkdown={editorMd}
        resetKey={`${entry.id}:${editorReloadKey}`}
        toolbarInset={toolbarInset}
        onChange={(md) => {
          setBody(md);
          scheduleSave(title, md);
        }}
      />
    </article>
  );
}

