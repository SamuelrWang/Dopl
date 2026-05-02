"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRefetchOnFocus } from "@/shared/hooks/use-refetch-on-focus";
import { toast } from "@/shared/ui/toast";
import {
  KnowledgeApiError,
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
  /** Called when the server returns 412 (stale updated_at). Parent
   *  should refetch the entry's full body so the next save isn't
   *  rejected on the same precondition. */
  onStaleVersion: () => void;
  /** Called when the tab regains focus AND the editor has no unsaved
   *  edits. Parent should refetch the tree + the active entry body so
   *  the user sees changes another tab/agent saved while away. */
  onFocusRefetch?: () => void;
}

/**
 * Document view of a single entry. Title + body are debounce-saved
 * to the API ~1.5s after the user stops typing. Status indicator in
 * the header transitions: idle → dirty → saving → saved → idle.
 *
 * Concurrency:
 *   - Every PATCH carries an `X-Updated-At` precondition. The server
 *     returns 412 if a parallel writer beat us; the user gets a toast
 *     and the parent refetches.
 *   - On tab focus while the editor is clean, `onFocusRefetch` pulls
 *     the latest server state so the user sees other tabs' / agents'
 *     edits without a manual reload.
 *   - Unmount-flush (entry switch / page nav) sends one final PUT
 *     with the same precondition so a stale unmount doesn't clobber a
 *     newer parallel write.
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
  // Track the last successfully saved values so we don't fire a save
  // for content that already matches what's in the DB.
  const lastSaved = useRef({ title: entry.title, body: entry.body });
  // The `updated_at` we last observed — sent as the `X-Updated-At`
  // precondition on the next PATCH. When the server returns 412 we
  // refetch and reset this to the fresh value.
  const expectedUpdatedAtRef = useRef(entry.updatedAt);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of the latest in-memory values so the unmount-flush sees
  // current edits even if React state is stale within cleanup.
  const latestRef = useRef({ title, body });
  useEffect(() => {
    latestRef.current = { title, body };
  });

  // Reset when switching entries — the parent passes a `key` so the
  // component remounts; seed lastSaved here to avoid an immediate save
  // on first mount.
  useEffect(() => {
    lastSaved.current = { title: entry.title, body: entry.body };
    expectedUpdatedAtRef.current = entry.updatedAt;
  }, [entry.id, entry.title, entry.body, entry.updatedAt]);

  // Tab regained focus AND the editor isn't dirty — pull the latest.
  useRefetchOnFocus(
    () => {
      onFocusRefetch?.();
    },
    {
      skip: () => status === "dirty" || status === "saving",
    }
  );

  // Cleanup + flush on unmount. If there are unsaved edits when the
  // user switches entries (parent uses `key={entry.id}` so unmount
  // fires on every entry switch), fire a final save in the background.
  // The `expectedUpdatedAt` precondition guarantees we drop our edits
  // rather than overwrite a parallel writer's.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      const { title: t, body: b } = latestRef.current;
      const last = lastSaved.current;
      if (t !== last.title || b !== last.body) {
        const expectedUpdatedAt = expectedUpdatedAtRef.current;
        apiUpdateEntry(
          entry.id,
          { title: t, body: b },
          workspaceId,
          expectedUpdatedAt
        ).catch((err: unknown) => {
          if (err instanceof KnowledgeApiError && err.status === 412) {
            console.warn(
              "[knowledge] unmount autosave dropped (412 stale)",
              { entryId: entry.id }
            );
            return;
          }
        });
      }
    };
    // entry.id and workspaceId are stable for this mount (parent uses
    // key=entry.id). Empty deps intentionally — captures values at
    // mount time which is exactly what we want to save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleSave = useCallback(
    (nextTitle: string, nextBody: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setStatus("dirty");
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
            toast({
              title: "Edited in another tab",
              description: "Reloaded the latest version — try saving again.",
            });
            onStaleVersion();
            setStatus("error");
            return;
          }
          setStatus("error");
          reportError(err, "Couldn't save entry");
        }
      }, AUTOSAVE_DELAY_MS);
    },
    [entry.id, workspaceId, onSaved, onStaleVersion]
  );

  return (
    <article className="flex flex-col">
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
        initialMarkdown={entry.body}
        resetKey={entry.id}
        onChange={(md) => {
          setBody(md);
          scheduleSave(title, md);
        }}
      />
    </article>
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
