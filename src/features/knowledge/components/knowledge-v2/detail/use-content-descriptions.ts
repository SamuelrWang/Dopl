"use client";

import { useCallback, useEffect, useState } from "react";
import { DESCRIPTION_MAX } from "@/config";
import { updateEntry, updateFolder } from "../../../client/api";
import type { KnowledgeEntry, KnowledgeFolder } from "../../../types";
import { reportError } from "../utils";

/**
 * Inline-edit persistence for a base's folder descriptions + entry
 * excerpts (Feature B "Contents" tree). Reuses the existing by-id PATCH
 * routes (`updateFolder` carries `description`, `updateEntry` carries
 * `excerpt` — both session-authenticated, so `last_edited_source`
 * stays `'user'`), then asks the controller to refresh the base's tree
 * so the change flows back down through props.
 *
 * Optimistic: a committed value shows immediately via a per-node override
 * that self-clears once the refreshed tree carries the same value (or on
 * error, reverts). Node ids are UUIDs, so folder + entry ids never collide.
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

  // Drop an override once the refreshed tree carries the same value — our
  // save landed, so the prop tree is now authoritative. Depends only on the
  // incoming props (never on `overrides`) so it can't loop.
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
