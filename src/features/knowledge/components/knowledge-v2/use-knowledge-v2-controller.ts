"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchEntry as apiFetchEntry, fetchTree } from "../../client/api";
import { useKnowledgeEntry } from "../../client/hooks";
import { useKnowledgeRealtime } from "../../client/realtime";
import { kbScope } from "../../scope";
import type { KnowledgeBase, KnowledgeEntry } from "../../types";
import { knowledgeBaseSegment } from "../../url";
import type { BaseTree, ListFilter, Selection } from "./types";
import { reportError } from "./utils";
import { useKnowledgeV2Trees } from "./use-knowledge-v2-trees";

interface ControllerArgs {
  workspaceId: string;
  /** Canonical workspace URL segment, for building /knowledge/{base} URLs. */
  workspaceSegment: string;
  bases: KnowledgeBase[];
  /** SSR-resolved initial selection (deep-link target), if any. */
  initialSelection?: Selection | null;
  /** SSR-resolved trees to seed (e.g. the deep-linked base), keyed by baseId. */
  initialTrees?: Record<string, BaseTree>;
}

/** Path + search the URL should hold for a given selection. */
function targetUrl(
  workspaceSegment: string,
  selection: Selection | null
): string {
  const base = `/${workspaceSegment}/knowledge`;
  if (!selection) return base;
  const seg = knowledgeBaseSegment(selection.base);
  if (selection.kind === "entry") {
    return `${base}/${seg}?entryId=${selection.entry.id}`;
  }
  return `${base}/${seg}`;
}

/**
 * Owns the Knowledge V2 root's client state: scope filter, base-name search,
 * per-base expansion + lazily-loaded trees, the detail selection, and the
 * open entry's body. Keeps the URL in sync with the selection (shallow history
 * updates, no navigation) and re-derives the selection on browser back/forward.
 * Tree mutations live in `useKnowledgeV2Trees`; this composes them in.
 */
export function useKnowledgeV2Controller({
  workspaceId,
  workspaceSegment,
  bases,
  initialSelection = null,
  initialTrees,
}: ControllerArgs) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialSelection ? [initialSelection.base.id] : [])
  );
  const [trees, setTrees] = useState<Record<string, BaseTree>>(
    () => initialTrees ?? {}
  );
  const [selection, setSelection] = useState<Selection | null>(initialSelection);

  // Body of the currently-open entry. Owned here (not in EntryView) so realtime
  // can refetch it. The tree strips bodies, so a metadata-only selection
  // fetches; a deep-linked entry that already carries its body seeds the hook.
  const openSeed =
    selection?.kind === "entry" && selection.entry.body ? selection.entry : null;
  const openEntryQuery = useKnowledgeEntry(
    selection?.kind === "entry" ? selection.entry.id : null,
    workspaceId,
    openSeed ? { initialData: openSeed, initialEntryId: openSeed.id } : undefined
  );

  const visibleBases = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bases.filter((b) => {
      if (filter !== "all" && kbScope(b) !== filter) return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        (b.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [bases, filter, query]);

  const loadTree = useCallback(
    async (baseId: string) => {
      setTrees((prev) => ({
        ...prev,
        [baseId]: { status: "loading", folders: [], entries: [] },
      }));
      try {
        const tree = await fetchTree(baseId, workspaceId);
        setTrees((prev) => ({
          ...prev,
          [baseId]: {
            status: "ready",
            folders: tree.folders,
            entries: tree.entries,
          },
        }));
      } catch {
        setTrees((prev) => ({
          ...prev,
          [baseId]: { status: "error", folders: [], entries: [] },
        }));
      }
    },
    [workspaceId]
  );

  /** Silent refresh of one base's tree (no loading flash) — called after a
   *  mutation or autosave so the list reflects new titles/timestamps. Also
   *  reconciles the selection: if the open entry was deleted/moved away it
   *  downgrades to the base; otherwise it re-points at the fresh metadata. */
  const refreshTree = useCallback(
    async (baseId: string) => {
      try {
        const tree = await fetchTree(baseId, workspaceId);
        setTrees((prev) => ({
          ...prev,
          [baseId]: {
            status: "ready",
            folders: tree.folders,
            entries: tree.entries,
          },
        }));
        setSelection((prev) => {
          if (!prev || prev.base.id !== baseId || prev.kind !== "entry") {
            return prev;
          }
          const fresh = tree.entries.find((e) => e.id === prev.entry.id);
          return fresh
            ? { kind: "entry", base: prev.base, entry: fresh }
            : { kind: "base", base: prev.base };
        });
      } catch {
        // Leave the existing tree in place; a transient refresh failure
        // shouldn't blank the pane. The next mutation/realtime retries.
      }
    },
    [workspaceId]
  );

  const handleToggleExpand = useCallback(
    (base: KnowledgeBase) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(base.id)) {
          next.delete(base.id);
        } else {
          next.add(base.id);
          if (!trees[base.id]) void loadTree(base.id);
        }
        return next;
      });
    },
    [trees, loadTree]
  );

  const handleSelectBase = useCallback((base: KnowledgeBase) => {
    setSelection({ kind: "base", base });
  }, []);

  const handleSelectEntry = useCallback(
    (base: KnowledgeBase, entry: KnowledgeEntry) => {
      setSelection({ kind: "entry", base, entry });
    },
    []
  );

  const closeSelection = useCallback(() => setSelection(null), []);

  // Tree CRUD/move/delete/download handlers + the access gate + dialog state,
  // extracted to keep this file under the size cap.
  const mut = useKnowledgeV2Trees({
    workspaceId,
    bases,
    refreshTree,
    setSelection,
  });

  /** Open an entry from a content-search hit — uses the loaded tree if the
   *  base is open, else fetches the entry directly (and expands the base). */
  const selectEntryById = useCallback(
    async (entryId: string, baseId: string) => {
      const base = bases.find((b) => b.id === baseId);
      if (!base) return;
      const tree = trees[baseId];
      const fromTree =
        tree?.status === "ready"
          ? tree.entries.find((e) => e.id === entryId)
          : undefined;
      if (fromTree) {
        setSelection({ kind: "entry", base, entry: fromTree });
        return;
      }
      try {
        const entry = await apiFetchEntry(entryId, workspaceId);
        setSelection({ kind: "entry", base, entry });
        setExpanded((prev) => new Set(prev).add(baseId));
        if (!trees[baseId]) void loadTree(baseId);
      } catch (err) {
        reportError(err, "Couldn't open the search result");
      }
    },
    [bases, trees, workspaceId, loadTree]
  );

  /** Breadcrumb navigation: jump to the first entry directly inside a folder
   *  (`null` = the KB-root crumb → first entry in the base). */
  const selectCrumb = useCallback(
    (base: KnowledgeBase, folderId: string | null) => {
      const tree = trees[base.id];
      if (!tree || tree.status !== "ready") {
        setSelection({ kind: "base", base });
        return;
      }
      const target =
        folderId === null
          ? tree.entries[0]
          : tree.entries.find((e) => e.folderId === folderId);
      setSelection(
        target ? { kind: "entry", base, entry: target } : { kind: "base", base }
      );
    },
    [trees]
  );

  // Live updates from MCP/CLI agents and other tabs: any change to this
  // workspace's bases/folders/entries refreshes every loaded tree and the
  // open entry. DocPane's clean-only re-seed guard prevents clobbering an
  // active typer. onChange is captured in a ref by the hook — passing a fresh
  // inline closure each render is intentional (no re-subscribe churn).
  useKnowledgeRealtime(workspaceId, () => {
    for (const baseId of Object.keys(trees)) void refreshTree(baseId);
    openEntryQuery.refetch();
  });

  // ── URL ↔ selection sync ───────────────────────────────────────────
  // Write the address bar to match the selection without navigating (no
  // server round-trip, no shell remount). New base → pushState (Back returns
  // to the prior base); entry-within-base or close → replaceState.
  const prevBaseIdRef = useRef<string | null>(initialSelection?.base.id ?? null);
  useEffect(() => {
    const target = targetUrl(workspaceSegment, selection);
    const current = window.location.pathname + window.location.search;
    const nextBaseId = selection?.base.id ?? null;
    if (target !== current) {
      if (nextBaseId && nextBaseId !== prevBaseIdRef.current) {
        window.history.pushState(null, "", target);
      } else {
        window.history.replaceState(null, "", target);
      }
    }
    prevBaseIdRef.current = nextBaseId;
  }, [selection, workspaceSegment]);

  // Back/forward: re-derive the selection from the URL so the view actually
  // changes (not just the address bar). Matches the base by canonical segment,
  // restores the entry if its tree is already loaded.
  useEffect(() => {
    function onPopState() {
      const parts = window.location.pathname.split("/").filter(Boolean);
      // /{ws}/knowledge/{seg?}
      const seg = parts[1] === "knowledge" ? parts[2] : undefined;
      if (!seg) {
        setSelection(null);
        return;
      }
      const base = bases.find((b) => knowledgeBaseSegment(b) === seg);
      if (!base) return;
      setExpanded((prev) => new Set(prev).add(base.id));
      if (!trees[base.id]) void loadTree(base.id);
      const entryId = new URLSearchParams(window.location.search).get("entryId");
      const tree = trees[base.id];
      const entry =
        entryId && tree?.status === "ready"
          ? tree.entries.find((e) => e.id === entryId)
          : undefined;
      setSelection(entry ? { kind: "entry", base, entry } : { kind: "base", base });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [bases, trees, loadTree]);

  const selectedBaseId = selection?.base.id ?? null;
  const selectedEntryId =
    selection?.kind === "entry" ? selection.entry.id : null;

  return {
    query,
    setQuery,
    filter,
    setFilter,
    visibleBases,
    expanded,
    trees,
    selection,
    selectedBaseId,
    selectedEntryId,
    openEntry: openEntryQuery.data,
    openEntryStatus: openEntryQuery.status,
    refetchOpenEntry: openEntryQuery.refetch,
    refreshTree,
    handleToggleExpand,
    handleSelectBase,
    handleSelectEntry,
    selectEntryById,
    selectCrumb,
    closeSelection,
    ...mut,
  };
}

export type { TreeHandlers } from "./use-knowledge-v2-trees";
