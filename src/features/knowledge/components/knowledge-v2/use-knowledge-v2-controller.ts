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

/** Stable empty array — a fresh `[]` per render would re-run every memo that
 *  depends on the star set (and, downstream, re-sort the grid) forever. */
const EMPTY_STARS: string[] = [];

interface ControllerArgs {
  workspaceId: string;
  /** Canonical workspace URL segment, for building /knowledge/{base} URLs. */
  workspaceSegment: string;
  /** SSR-resolved bases — the SEED for the live client query, not the source
   *  of truth. Agent/remote edits to base name/description flow in via the
   *  knowledge realtime subscriber refetching the query (F-038(2)). */
  initialBases: KnowledgeBase[];
  /** SSR-resolved initial selection (deep-link target), if any. */
  initialSelection?: Selection | null;
  /** SSR-resolved trees to seed (e.g. the deep-linked base), keyed by baseId. */
  initialTrees?: Record<string, BaseTree>;
  /**
   * How selection ↔ address bar sync happens. Defaults to the web app's
   * History-API implementation; the desktop SPA passes a hash-router adapter
   * so the same two effects below drive both (see ./routing.ts).
   */
  urlSync?: KnowledgeUrlSync;
}

/**
 * Owns the Knowledge V2 root's client state: scope filter, base-name search,
 * lazily-loaded trees, the detail selection, and the open entry's body. Keeps
 * the URL in sync with the selection (shallow history updates, no navigation)
 * and re-derives the selection on browser back/forward. Tree mutations live in
 * `useKnowledgeV2Trees`; this composes them in.
 *
 * **`selection === null` IS THE HOME MODE.** The knowledge root renders a card
 * grid over `visibleBases`, and a base's page renders the two-pane tree+detail
 * view — one component, one controller, and the selection decides which
 * (`knowledge-v2.tsx`). That is why nothing here auto-selects a base any more:
 * an auto-select at `/knowledge` would rewrite the URL to a base before the
 * grid ever painted, making the home route unreachable. Selection is only ever
 * set by a user move (a card, a tree row, back/forward) or a deep link.
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
  // Bases are a live client query seeded from SSR (no skeleton flash) so
  // agent/remote base name/description edits appear without a reload —
  // the realtime subscriber below refetches it. Everything downstream reads
  // this `bases` exactly as before.
  //
  // THE WHOLE LIST RESPONSE, not just its `bases` half: the caller's own stars
  // ride the same cache entry (`starredBaseIds`), and reading them from a
  // second hook would put the grid's order one render behind the toggle that
  // moved it. The seed's `starredBaseIds: []` is only ever reached on a COLD
  // entry, which this view cannot start from — its host resolves the same
  // query before it renders — so it never asserts "nothing starred" over a
  // real answer.
  const basesQuery = useKnowledgeBaseList(workspaceId, {
    initialData: {
      bases: initialBases,
      ownerNames: {},
      baseStats: {},
      kbStorageLimit: null,
      starredBaseIds: [],
    },
  });
  const bases = basesQuery.data?.bases ?? initialBases;
  const starredBaseIds = basesQuery.data?.starredBaseIds ?? EMPTY_STARS;

  // Per-user star toggle. Optimistic against the list cache above, so the grid
  // reorders on the click; a failure rolls the entry back (client/hooks.ts).
  const starMutation = useToggleBaseStar(workspaceId);
  const starMutate = starMutation.mutate;
  const toggleStar = useCallback(
    (baseId: string, starred: boolean) => starMutate({ baseId, starred }),
    [starMutate]
  );

  // A deep link is the ONLY thing that starts this view on a base. No base
  // in the URL means the home grid, so there is nothing to resolve and
  // nothing to auto-open — the previous "select the first base" seed (and
  // the per-workspace last-base preference that upgraded it) existed purely
  // to fill an empty right pane the grid now replaces.
  const initialResolvedSelection: Selection | null = initialSelection;

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [trees, setTrees] = useState<Record<string, BaseTree>>(
    () => initialTrees ?? {}
  );
  const [selection, setSelection] = useState<Selection | null>(
    initialResolvedSelection
  );

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

  // Two stages, because the scope pills carry COUNTS and a count is only
  // meaningful before its own filter runs: `queryBases` answers "what does
  // the search match", `visibleBases` narrows that to the active pill, and
  // the badges are cut from the stage in between.
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

  /** Open a base — the home grid's card, and the only way into detail mode
   *  that isn't a URL. The list pane shows exactly this base's tree, so
   *  there is no per-base expansion state left to set. */
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

  // Reconcile the selected base against the latest `bases` prop (derived, not
  // stored). The page re-pulls bases from SSR after a save (router.refresh()),
  // so a base rename — the user's own or a concurrent agent edit pulled in by
  // the same refresh — flows into the toolbar title and the overview's
  // read-only fields without a state-sync effect.
  const reconciledSelection = useMemo<Selection | null>(() => {
    if (!selection) return null;
    const fresh = bases.find((b) => b.id === selection.base.id);
    if (!fresh || fresh === selection.base) return selection;
    return selection.kind === "entry"
      ? { kind: "entry", base: fresh, entry: selection.entry }
      : { kind: "base", base: fresh };
  }, [selection, bases]);

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
    basesQuery.refetch();
    for (const baseId of Object.keys(trees)) void refreshTree(baseId);
    openEntryQuery.refetch();
  });

  // ── URL ↔ selection sync ───────────────────────────────────────────
  // Write the address bar to match the selection without navigating (no
  // server round-trip, no shell remount). New base → pushState (Back returns
  // to the prior base); entry-within-base or close → replaceState.
  const prevBaseIdRef = useRef<string | null>(
    initialResolvedSelection?.base.id ?? null
  );
  // The URL this controller last put there. The SPA's router notifies on
  // EVERY location change, its own writes included; without this the
  // notification below would re-derive a selection from a URL we just wrote
  // and downgrade an entry selection whose tree hasn't loaded yet.
  const lastWrittenUrlRef = useRef<string | null>(null);
  // RECONCILED, not raw: the URL is built from the base's slug, and a rename
  // reaches this tree as a fresh `bases` row rather than a new selection. On
  // the raw state the address bar would keep — and later re-assert — the slug
  // the base had when it was selected.
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

  // Back/forward (and, in the SPA, a programmatic navigation from the create
  // dialog or a delete): re-derive the selection from the URL so the view
  // actually changes, not just the address bar. Matches the base by canonical
  // segment, restores the entry if its tree is already loaded.
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
      // One grammar, one resolver: `findBaseBySegment` is the same matcher the
      // page uses for a deep link, so a legacy slug-only URL arriving over
      // Back/Forward resolves here exactly as it does on a cold load.
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
    /** Search-matched bases, BEFORE the scope pill — what the counts count. */
    queryBases,
    /** Per-pill badge counts, cut from `queryBases`. */
    filterCounts,
    visibleBases,
    /** The CALLER'S starred base ids — the home grid lifts these to the front.
     *  Stars never touch `filterCounts`: a favourite changes the ORDER of the
     *  results, never which ones there are. */
    starredBaseIds,
    toggleStar,
    trees,
    selection: reconciledSelection,
    selectedBaseId,
    selectedEntryId,
    openEntry: openEntryQuery.data,
    openEntryStatus: openEntryQuery.status,
    refetchOpenEntry: openEntryQuery.refetch,
    /** Refetch the bases list — called after a local base edit so the user's
     *  own rename/description change reflects without waiting on realtime. */
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
