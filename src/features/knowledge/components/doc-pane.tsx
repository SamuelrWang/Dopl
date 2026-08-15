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
import type { Editor } from "@tiptap/react";
import { DocEditor, SaveStatusIndicator, type SaveStatus } from "@/shared/editor/doc-editor";
import { ConflictBanner, reportError } from "./doc-pane-chrome";

const AUTOSAVE_DELAY_MS = 1500;

export interface DocPaneProps {
  /** ⚠ MUST be full entry (body + fresh `updated_at`) — body-stripped tree
   *  entry makes first autosave write `body: ""` over document. */
  entry: KnowledgeEntry;
  workspaceId: string;
  /** Parent refetches tree for new title/updated_at. */
  onSaved: () => void;
  /** 412 detected. Notification only — DocPane owns recovery. */
  onStaleVersion?: () => void;
  /** Focus regained AND editor clean AND no conflict. */
  onFocusRefetch?: () => void;
  /** Live editor, so the host renders the toolbar in its header band. */
  onEditor?: (editor: Editor | null) => void;
}

/** Server snapshot taken at 412. While set: autosave paused (would 412 again),
 *  banner offers explicit resolution, editor stays editable. */
interface ConflictState {
  serverTitle: string;
  serverBody: string;
  serverUpdatedAt: string;
}

/**
 * One entry. Title + body debounce-saved ~1.5s after typing stops.
 * Status: idle → dirty → saving → saved → idle.
 *
 * ⚠ Concurrency model — never overwrite the editor silently:
 *   - every PATCH carries the `X-Updated-At` precondition;
 *   - on 412, fetch server state into ConflictState and pause autosave. Server
 *     content is NOT pushed into the editor; the user picks;
 *   - unmount-flush skipped in conflict, or a background save overwrites the
 *     resolution the user was about to pick.
 *
 * Editor content owned locally (`editorReloadKey` + `initialMarkdown`); `entry`
 * reseeds only on entry switch (parent keys on `entry.id`) or a clean focus
 * refetch — never over unsaved edits.
 */
export function DocPane({
  entry,
  workspaceId,
  onSaved,
  onStaleVersion,
  onFocusRefetch,
  onEditor,
}: DocPaneProps) {
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [resolving, setResolving] = useState(false);
  // Agent-facing description (`excerpt` column). Blur-saved through the same
  // updated_at precondition so it can't 412 the next body autosave.
  const [description, setDescription] = useState(entry.excerpt ?? "");
  const lastSavedDescription = useRef(entry.excerpt ?? "");

  // ⚠ Bumping `editorReloadKey` re-seeds Tiptap from `editorMd`. ONLY on
  // entry switch (remount) and user-driven "Discard mine, reload" — realtime
  // echo and parent refetches must NOT touch it.
  const [editorMd, setEditorMd] = useState(entry.body);
  const [editorReloadKey, setEditorReloadKey] = useState(0);

  // Debounced autosave skips when current matches.
  const lastSaved = useRef({ title: entry.title, body: entry.body });
  // The `X-Updated-At` precondition.
  const expectedUpdatedAtRef = useRef(entry.updatedAt);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ⚠ Unmount-flush mirror: React state is stale inside cleanup.
  const latestRef = useRef({ title, body });
  useEffect(() => {
    latestRef.current = { title, body };
  });

  // Refs so empty-deps unmount-flush reads fresh values without re-running.
  const conflictRef = useRef<ConflictState | null>(null);
  const statusRef = useRef<SaveStatus>("idle");
  conflictRef.current = conflict;
  statusRef.current = status;

  const selfProfile = useCurrentProfile();
  const presencePeers = usePresence(
    `presence:kb-entry:${entry.id}`,
    selfProfile,
    status === "dirty" || status === "saving"
  );
  const otherEditors = presencePeers.filter(
    (p) => p.userId !== selfProfile?.userId
  );

  // ⚠ Re-seed from `entry` prop ONLY when safe (not dirty/saving, no
  // conflict) — otherwise it clobbers unsaved edits. Handles in-place
  // refreshes only; entry switch remounts (parent keys on `entry.id`).
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

  // Unmount flush. ⚠ Captures entry.id/workspaceId at MOUNT deliberately —
  // deterministic snapshot of what was being saved. Skipped in conflict.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      if (conflictRef.current !== null) return;
      const { title: t, body: b } = latestRef.current;
      const last = lastSaved.current;
      if (t === last.title && b === last.body) return;
      // Via save chain: must run AFTER any in-flight save to read the token
      // that save produced, not a stale one.
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
            // Editor unmounted — no resolution UI. Toast beats dropping the
            // edit silently.
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

  /** Snapshot server entry into conflict state: pauses autosave, surfaces the
   *  banner. ⚠ Does NOT touch editor content. */
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

  // ⚠ Serialize every PATCH through one chain — two saves must never be in
  // flight together. Body autosave, description blur and conflict resolution
  // share one `updated_at` token; an overlapping pair 412s against our own
  // write (phantom "edited elsewhere" with a single editor).
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueSave = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = saveChainRef.current.then(job, job);
    // Swallowed tail so an unawaited failing job can't become an unhandled
    // rejection; callers awaiting `next` still see it.
    saveChainRef.current = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }, []);

  const scheduleSave = useCallback(
    (nextTitle: string, nextBody: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // User MAY keep typing during conflict: show dirty, but schedule no
      // round-trip (would 412 again).
      setStatus("dirty");
      if (conflictRef.current !== null) return;
      timerRef.current = setTimeout(() => {
        void enqueueSave(async () => {
          // Re-check inside the chain: a queued-behind save may have entered
          // conflict or already written this content.
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

  /** Conflict resolution: keep local edits, overwrite server. Precondition is
   *  the conflict's serverUpdatedAt, so we win on top of the freshest known
   *  state; a writer slipping in between fetch and PATCH 412s and re-enters
   *  conflict — never silently overwrite a newer unseen version. */
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

  /** Conflict resolution: discard local edits, reload server version into the
   *  editor. User chose this explicitly, so cursor/content jump is expected. */
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
      {/* Header panel: the one place the file name shows, plus the
          agent-facing description (entry `excerpt`) that MCP clients get in
          tree / directory listings. */}
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
        hideToolbar
        onEditor={onEditor}
        onChange={(md) => {
          setBody(md);
          scheduleSave(title, md);
        }}
      />
    </article>
  );
}

