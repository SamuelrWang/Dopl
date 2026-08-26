"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchEntry as apiFetchEntry, fetchTree } from "../../client/api";
import {
  useKnowledgeBaseList,
  useKnowledgeEntry,
  useToggleBaseStar,
} from "../../client/hooks";
import { useKnowledgeRealtime } from "../../client/realtime";
import { kbScope } from "../../scope";
import type { KnowledgeBase, KnowledgeEntry } from "../../types";
import { findBaseBySegment } from "../../url";
import type { BaseTree, ListFilter, Selection } from "./types";
import {
  createHistoryUrlSync,
  locationForSelection,
  type KnowledgeUrlSync,
} from "./routing";
import { reportError } from "./utils";
import { scopeCounts } from "./list-filters";
import { useKnowledgeV2Trees } from "./use-knowledge-v2-trees";

/** ⚠ Stable ref: a fresh `[]` per render re-runs every star-dependent memo
 *  (and re-sorts the grid) forever. */
const EMPTY_STARS: string[] = [];

interface ControllerArgs {
  workspaceId: string;
  /** Canonical workspace URL segment, for /knowledge/{base} URLs. */
  workspaceSegment: string;
  /** SSR SEED for the live client query, not source of truth. Agent/remote
   *  name/description edits arrive via realtime refetch (F-038(2)). */
  initialBases: KnowledgeBase[];
  initialSelection?: Selection | null;
  initialTrees?: Record<string, BaseTree>;
  /** Selection ↔ address bar sync. Defaults to History API; desktop SPA passes
   *  a hash-router adapter so the same two effects drive both (./routing.ts). */
  urlSync?: KnowledgeUrlSync;
}

/**
 * Owns Knowledge V2 root client state: scope filter, search, lazy trees,
 * selection, open entry body. Tree mutations live in `useKnowledgeV2Trees`.
 *
 * **`selection === null` IS HOME MODE** — one component, one controller, the
 * selection picks grid vs two-pane (`knowledge-v2.tsx`). ⚠ Never auto-select a
 * base: an auto-select at `/knowledge` rewrites the URL before the grid paints,
 * making the home route unreachable. Selection is set only by a user move
 * (card, tree row, back/forward) or a deep link.
 */
export function useKnowledgeV2Controller({
  workspaceId,
  workspaceSegment,
  initialBases,
  initialSelection = null,
  initialTrees,
  urlSync,
}: ControllerArgs) {
  const sync = useMemo(
    () => urlSync ?? createHistoryUrlSync(workspaceSegment),
    [urlSync, workspaceSegment]
  );
  // Live client query seeded from SSR (no skeleton flash); realtime refetches.
  // ⚠ Read THE WHOLE LIST RESPONSE, not just `bases`: the caller's stars ride
  // the same cache entry (`starredBaseIds`), and a second hook would put grid
  // order one render behind the toggle. Seed's `starredBaseIds: []` is only
  // reached on a COLD entry, which this view cannot start from (host resolves
  // the same query first), so it never overrides a real answer.
  const basesQuery = useKnowledgeBaseList(workspaceId, {
    initialData: {
      bases: initialBases,
      ownerNames: {},
      baseStats: {},
      kbStorageLimit: null,
      starredBaseIds: [],
      // This view is never channel-scoped; no scope-A grants to seed.
      channelGrants: {},
    },
  });
  const bases = basesQuery.data?.bases ?? initialBases;
  const starredBaseIds = basesQuery.data?.starredBaseIds ?? EMPTY_STARS;

  // Optimistic against the list cache above (grid reorders on click); failure
  // rolls back — client/hooks.ts.
  const starMutation = useToggleBaseStar(workspaceId);
  const starMutate = starMutation.mutate;
  const toggleStar = useCallback(
    (baseId: string, starred: boolean) => starMutate({ baseId, starred }),
    [starMutate]
  );

  // ⚠ A deep link is the ONLY thing that starts this view on a base; no base
  // in the URL means home grid. Nothing to resolve, nothing to auto-open.
  const initialResolvedSelection: Selection | null = initialSelection;

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [trees, setTrees] = useState<Record<string, BaseTree>>(
    () => initialTrees ?? {}
  );
  const [selection, setSelection] = useState<Selection | null>(
    initialResolvedSelection
  );

  // Open entry body owned here (not EntryView) so realtime can refetch it. The
  // tree strips bodies, so a metadata-only selection fetches; a deep-linked
  // entry carrying its body seeds the hook.
  const openSeed =
    selection?.kind === "entry" && selection.entry.body ? selection.entry : null;
  const openEntryQuery = useKnowledgeEntry(
    selection?.kind === "entry" ? selection.entry.id : null,
    workspaceId,
    openSeed ? { initialData: openSeed, initialEntryId: openSeed.id } : undefined
  );

  // Two stages, because a scope pill's COUNT is only meaningful before its own
  // filter runs: `queryBases` = search matches, `visibleBases` = active pill,
  // badges cut from the stage in between.
  const queryBases = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bases;
    return bases.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.description?.toLowerCase().includes(q) ?? false)
    );
  }, [bases, query]);

  const filterCounts = useMemo(() => scopeCounts(queryBases), [queryBases]);

  const visibleBases = useMemo(
    () =>
      filter === "all"
        ? queryBases
        : queryBases.filter((b) => kbScope(b) === filter),
    [queryBases, filter]
  );

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

  /** Silent tree refresh (no loading flash) after mutation/autosave. Also
   *  reconciles selection: open entry deleted/moved → downgrade to base,
   *  else re-point at fresh metadata. */
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
        // Keep existing tree: transient refresh failure must not blank the
        // pane. Next mutation/realtime retries.
      }
    },
    [workspaceId]
  );

  /** Home grid card: the only non-URL way into detail mode. */
  const handleSelectBase = useCallback(
    (base: KnowledgeBase) => {
      setSelection({ kind: "base", base });
      if (!trees[base.id]) void loadTree(base.id);
    },
    [trees, loadTree]
  );

  const handleSelectEntry = useCallback(
    (base: KnowledgeBase, entry: KnowledgeEntry) => {
      setSelection({ kind: "entry", base, entry });
    },
    []
  );

  // Selected base reconciled against latest `bases` — derived, not stored, so a
  // rename (own or concurrent agent edit) flows into the toolbar title and
  // overview fields with no state-sync effect.
  const reconciledSelection = useMemo<Selection | null>(() => {
    if (!selection) return null;
    const fresh = bases.find((b) => b.id === selection.base.id);
    if (!fresh || fresh === selection.base) return selection;
    return selection.kind === "entry"
      ? { kind: "entry", base: fresh, entry: selection.entry }
      : { kind: "base", base: fresh };
  }, [selection, bases]);

  // Tree CRUD/move/delete/download + access gate + dialog state, split out to
  // hold this file under the 500-line cap.
  const mut = useKnowledgeV2Trees({
    workspaceId,
    bases,
    refreshTree,
    setSelection,
  });

  /** Open an entry from a content-search hit: loaded tree if base is open,
   *  else fetch the entry directly and expand the base. */
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
        if (!trees[baseId]) void loadTree(baseId);
      } catch (err) {
        reportError(err, "Couldn't open the search result");
      }
    },
    [bases, trees, workspaceId, loadTree]
  );

  /** Breadcrumb nav: first entry inside a folder (`null` = KB-root crumb →
   *  first entry in the base). */
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

  // Live updates from MCP/CLI agents + other tabs refresh every loaded tree and
  // the open entry. DocPane's clean-only re-seed guard stops clobbering an
  // active typer. ⚠ Hook captures onChange in a ref, so the fresh inline
  // closure each render is intentional — no re-subscribe churn.
  useKnowledgeRealtime(workspaceId, () => {
    basesQuery.refetch();
    for (const baseId of Object.keys(trees)) void refreshTree(baseId);
    openEntryQuery.refetch();
  });

  // ── URL ↔ selection sync ───────────────────────────────────────────
  // Address bar written without navigating (no round-trip, no shell remount).
  // New base → pushState; entry-within-base or close → replaceState.
  const prevBaseIdRef = useRef<string | null>(
    initialResolvedSelection?.base.id ?? null
  );
  // ⚠ URL this controller last wrote. SPA router notifies on EVERY location
  // change, its own writes included; without this the subscriber below
  // re-derives from a URL we just wrote and downgrades an entry selection
  // whose tree hasn't loaded.
  const lastWrittenUrlRef = useRef<string | null>(null);
  // ⚠ RECONCILED, not raw: URL is built from the base slug, and a rename
  // arrives as a fresh `bases` row, not a new selection. Raw state would keep
  // — and re-assert — the slug held at selection time.
  useEffect(() => {
    const target = sync.urlFor(locationForSelection(reconciledSelection));
    const nextBaseId = reconciledSelection?.base.id ?? null;
    if (target !== sync.current()) {
      sync.write(
        target,
        nextBaseId && nextBaseId !== prevBaseIdRef.current ? "push" : "replace"
      );
    }
    lastWrittenUrlRef.current = target;
    prevBaseIdRef.current = nextBaseId;
  }, [reconciledSelection, sync]);

  // Back/forward (and SPA programmatic navigation from create dialog/delete):
  // re-derive selection from the URL so the view changes, not just the address
  // bar. Base matched by canonical segment; entry restored if tree is loaded.
  useEffect(() => {
    return sync.subscribe(() => {
      const { baseSegment, entryId } = sync.read();
      if (sync.urlFor({ baseSegment, entryId }) === lastWrittenUrlRef.current) {
        return;
      }
      if (!baseSegment) {
        setSelection(null);
        return;
      }
      // Same matcher the page uses for deep links, so a legacy slug-only URL
      // over Back/Forward resolves exactly as on a cold load.
      const base = findBaseBySegment(bases, baseSegment);
      if (!base) return;
      if (!trees[base.id]) void loadTree(base.id);
      const tree = trees[base.id];
      const entry =
        entryId && tree?.status === "ready"
          ? tree.entries.find((e) => e.id === entryId)
          : undefined;
      setSelection(entry ? { kind: "entry", base, entry } : { kind: "base", base });
    });
  }, [sync, bases, trees, loadTree]);

  const selectedBaseId = selection?.base.id ?? null;
  const selectedEntryId =
    selection?.kind === "entry" ? selection.entry.id : null;

  return {
    query,
    setQuery,
    filter,
    setFilter,
    /** Search-matched bases BEFORE the scope pill — what the counts count. */
    queryBases,
    filterCounts,
    visibleBases,
    /** CALLER'S starred base ids; home grid lifts these to the front. ⚠ Stars
     *  never touch `filterCounts` — they change ORDER, not membership. */
    starredBaseIds,
    toggleStar,
    trees,
    selection: reconciledSelection,
    selectedBaseId,
    selectedEntryId,
    openEntry: openEntryQuery.data,
    openEntryStatus: openEntryQuery.status,
    refetchOpenEntry: openEntryQuery.refetch,
    /** Refetch bases after a local edit so own rename/description shows
     *  without waiting on realtime. */
    refetchBases: basesQuery.refetch,
    refreshTree,
    handleSelectBase,
    handleSelectEntry,
    selectEntryById,
    selectCrumb,
    ...mut,
  };
}

export type { TreeHandlers } from "./use-knowledge-v2-trees";
