"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchEntry as apiFetchEntry, fetchTree } from "../../client/api";
import { useKnowledgeBases, useKnowledgeEntry } from "../../client/hooks";
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
import { readLastBaseId, writeLastBaseId } from "./last-base";
import { useKnowledgeV2Trees } from "./use-knowledge-v2-trees";

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
 * per-base expansion + lazily-loaded trees, the detail selection, and the
 * open entry's body. Keeps the URL in sync with the selection (shallow history
 * updates, no navigation) and re-derives the selection on browser back/forward.
 * Tree mutations live in `useKnowledgeV2Trees`; this composes them in.
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
  const basesQuery = useKnowledgeBases(workspaceId, { initialData: initialBases });
  const bases = basesQuery.data ?? initialBases;

  // Auto-select (Feature A): kill the empty right pane whenever ≥1 base
  // exists. A deep link (initialSelection) wins; otherwise seed the FIRST
  // SSR base deterministically so SSR + first client render agree (no
  // hydration mismatch, no landing-preview flash). A mount effect below
  // upgrades this to the per-workspace persisted base when one is stored.
  const initialResolvedSelection: Selection | null =
    initialSelection ??
    (initialBases.length > 0 ? { kind: "base", base: initialBases[0] } : null);
  // Read-once snapshot of the persisted preference (client-only; SSR → null,
  // never rendered so no hydration mismatch). Captured before any write so
  // the persist effect can't clobber it first.
  const [persistedBaseId] = useState<string | null>(() =>
    typeof window !== "undefined" ? readLastBaseId(workspaceId) : null
  );

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialResolvedSelection ? [initialResolvedSelection.base.id] : [])
  );
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

  const handleSelectBase = useCallback(
    (base: KnowledgeBase) => {
      setSelection({ kind: "base", base });
      // Selecting a base also opens its file tree; collapsing stays on
      // the chevron only, so re-clicking a selected base never folds it.
      setExpanded((prev) => {
        if (prev.has(base.id)) return prev;
        const next = new Set(prev);
        next.add(base.id);
        return next;
      });
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
      setExpanded((prev) => new Set(prev).add(base.id));
      if (!trees[base.id]) void loadTree(base.id);
      const tree = trees[base.id];
      const entry =
        entryId && tree?.status === "ready"
          ? tree.entries.find((e) => e.id === entryId)
          : undefined;
      setSelection(entry ? { kind: "entry", base, entry } : { kind: "base", base });
    });
  }, [sync, bases, trees, loadTree]);

  // ── Auto-select resolution (Feature A) ─────────────────────────────
  // Runs once the base list is available. A deep link is already applied
  // (initialSelection) and its tree seeded, so skip. Otherwise upgrade the
  // deterministic first-base seed to the per-workspace persisted base when
  // one is stored + still present, and make sure the selected base's tree
  // loads. Guarded so it resolves exactly once (fires when the list arrives
  // for a workspace that started with an empty SSR seed).
  const didResolveRef = useRef(false);
  useEffect(() => {
    if (didResolveRef.current) return;
    if (initialSelection) {
      didResolveRef.current = true;
      return;
    }
    // Zero bases: keep the empty/create state — nothing to select.
    if (bases.length === 0) return;
    didResolveRef.current = true;
    const preferred =
      (persistedBaseId
        ? bases.find((b) => b.id === persistedBaseId)
        : undefined) ?? bases[0];
    if (!preferred) return;
    if (selection?.base.id !== preferred.id) {
      // Auto-select replaces history rather than pushing (it's not a user
      // navigation): pre-seed the URL-sync ref so the effect uses replaceState.
      prevBaseIdRef.current = preferred.id;
      // One-shot resolution once the base list arrives — sanctioned mount-sync
      // pattern (same as use-ontology's first-snapshot seed), guarded by
      // didResolveRef so it runs at most once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelection({ kind: "base", base: preferred });
      setExpanded((prev) => new Set(prev).add(preferred.id));
    }
    if (!trees[preferred.id]) void loadTree(preferred.id);
  }, [bases, initialSelection, persistedBaseId, selection, trees, loadTree]);

  // Persist the selected base per workspace (any path: click, deep link,
  // auto-select) so the next visit reopens it.
  useEffect(() => {
    const baseId = selection?.base.id;
    if (baseId) writeLastBaseId(workspaceId, baseId);
  }, [selection?.base.id, workspaceId]);

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
    handleToggleExpand,
    handleSelectBase,
    handleSelectEntry,
    selectEntryById,
    selectCrumb,
    ...mut,
  };
}

export type { TreeHandlers } from "./use-knowledge-v2-trees";
