"use client";

import { useCallback, useEffect, useState } from "react";
import { DESCRIPTION_MAX } from "@/config";
import { updateEntry, updateFolder } from "../../../client/api";
import type { KnowledgeEntry, KnowledgeFolder } from "../../../types";
import { reportError } from "../utils";

/**
 * Inline-edit persistence for folder descriptions + entry excerpts (the
 * "Contents" tree). Uses the by-id PATCH routes (`updateFolder.description`,
 * `updateEntry.excerpt`) — both session-authenticated, so `last_edited_source`
 * stays `'user'` — then refreshes the base's tree so the change flows back
 * down through props.
 *
 * Optimistic per-node overrides that self-clear once the refreshed tree
 * carries the same value (or revert on error). ⚠ Node ids are UUIDs, so
 * folder and entry ids never collide in one override map.
 */
export type ContentNodeType = "folder" | "entry";

interface Args {
  baseId: string;
  workspaceId: string;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  onTreeRefresh: (baseId: string) => void;
}

export function useContentDescriptions({
  baseId,
  workspaceId,
  folders,
  entries,
  onTreeRefresh,
}: Args) {
  const [overrides, setOverrides] = useState<Map<string, string | null>>(
    () => new Map()
  );
  const [savingId, setSavingId] = useState<string | null>(null);

  // Drop an override once the refreshed tree carries the same value: our save
  // landed. ⚠ Depends only on incoming props (never `overrides`) or it loops.
  useEffect(() => {
    const actual = new Map<string, string | null>();
    for (const f of folders) actual.set(f.id, f.description);
    for (const e of entries) actual.set(e.id, e.excerpt);
    setOverrides((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const [id, val] of prev) {
        if (actual.has(id) && (actual.get(id) ?? null) === (val ?? null)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [folders, entries]);

  const resolve = useCallback(
    (id: string, fallback: string | null): string | null =>
      overrides.has(id) ? (overrides.get(id) ?? null) : fallback,
    [overrides]
  );

  const save = useCallback(
    async (
      type: ContentNodeType,
      id: string,
      current: string | null,
      rawValue: string
    ): Promise<void> => {
      const trimmed = rawValue.trim().slice(0, DESCRIPTION_MAX);
      const next = trimmed === "" ? null : trimmed;
      if ((current ?? "") === (next ?? "")) return; // no-op edit
      setOverrides((prev) => new Map(prev).set(id, next));
      setSavingId(id);
      try {
        if (type === "folder") {
          await updateFolder(id, { description: next }, workspaceId);
        } else {
          await updateEntry(id, { excerpt: next }, workspaceId);
        }
        onTreeRefresh(baseId);
      } catch (err) {
        setOverrides((prev) => {
          const m = new Map(prev);
          m.delete(id);
          return m;
        });
        reportError(err, "Couldn't save description");
      } finally {
        setSavingId((cur) => (cur === id ? null : cur));
      }
    },
    [baseId, workspaceId, onTreeRefresh]
  );

  return { resolve, save, savingId };
}
