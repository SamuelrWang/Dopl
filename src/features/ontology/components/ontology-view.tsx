"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import { pendingRow } from "@/shared/ui/pending";
import { useOntology } from "../hooks/use-ontology";
import { OntologyResourcesProvider } from "../hooks/use-workspace-resources";
import { CapNotice } from "./cap-notice";
import { ClusterSwitcher, clusterSwitcherEntries } from "./cluster-switcher";
import { DeleteClusterDialog } from "./delete-cluster-dialog";
import { KanbanBoard } from "./kanban-board";
import { ObjectPanel } from "./object-panel";
import { OntologyBoardSkeleton } from "./ontology-skeleton";

interface Props {
  workspaceId: string;
  workspaceSegment: string;
  /** Deep-linked cluster (`/[ws]/ontology/[clusterSlug]`); first cluster when omitted. */
  initialClusterSlug?: string;
  /**
   * SINGLE-ONTOLOGY MODE — pin the board to ONE cluster (2026-09-09, the /home
   * Ontology face; `docs/specs/home-ontology.md` §5).
   *
   * ⚠ **THE VIEW STILL LOADS THE CONTAINER'S WHOLE GRAPH, and that is not a
   * fence hole here**: the container is the caller's OWN personal one, so the
   * snapshot holds nothing they could not open anyway, and the same cache entry
   * backs the list they arrived from (`hooks/use-ontologies.ts`). This prop is a
   * SELECTION, never a permission — the fence is the ontology service's (§4).
   *
   * ⚠ WHAT IT SUPPRESSES, and why each is the HOST's job rather than a style:
   * the cluster STRIP (see `switcher` — /home replaced it with a DROPDOWN on
   * 2026-09-10 rather than going without a picker), the New cluster button
   * beside it, the DELETE button (the /home delete sits behind a confirm that
   * NAMES the channels the ontology is shared into — Q4 — which this view cannot
   * know), and the URL write (there is no URL on /home). Everything below the
   * header — the board, the object panel, the editors — is untouched.
   *
   * ⚠ A PIN THAT NAMES NOTHING RESOLVES TO NOTHING, never to `clusters[0]`.
   * Falling back would open a DIFFERENT ontology under the name the operator
   * clicked.
   *
   * ⚠ **THE PIN IS THE HOST'S SELECTION, so a host that offers a picker MOVES
   * it** — pair it with `onSelectCluster`, or the dropdown will change nothing.
   */
  pinnedClusterId?: string;
  /**
   * THE PICKER'S FACE (Samuel, 2026-09-10: the /home switcher is *"a dropdown"*,
   * not tabs). `"pills"` is the strip this page has always worn — and in pinned
   * mode it means NO picker at all, as it always has. `"dropdown"` is one
   * trigger over a `PopoverMenu` of every cluster in the container, which is
   * what fits a host with one line of chrome.
   *
   * ⚠ BOTH FACES READ ONE LIST (`cluster-switcher.tsx`). The mode chooses a
   * render, never a source.
   */
  switcher?: "pills" | "dropdown";
  /** Host-owned selection: fired beside the view's own state so a PINNED host
   *  can move its pin. Omit and the view keeps selecting for itself. */
  onSelectCluster?: (id: string) => void;
  /** Header slot BESIDE THE PICKER — /home's black "+ Ontology", which creates a
   *  new switcher entry and therefore belongs with the switcher. ⚠ A slot rather
   *  than a prop because the page button lives in `apps/desktop-ui`, downstream
   *  of this tree. */
  headerStart?: ReactNode;
  /** Header slot at the RIGHT, before "+ Column" — the host's own controls
   *  (/home's overflow: Share, Changelog, the agents toggle, Delete). */
  headerEnd?: ReactNode;
  /** Admin/owner — controls whether the upgrade prompt offers checkout. */
  canManageBilling?: boolean;
  /** Member+ — viewers read but can't create, so create affordances
   *  (New cluster / Column / Add new) are hidden. */
  canEdit?: boolean;
  /**
   * How the address bar follows the active cluster's slug. Defaults to
   * `history.replaceState`; RSC pages pass nothing (a server component can't
   * hand a function to a client component). ⚠ Desktop SPA injects its
   * hash-router equivalent — the packaged renderer is a `file://` document
   * where replacing the path is a Chromium security error.
   */
  replaceUrl?: (path: string) => void;
}

/** Module-level so the default is referentially stable across renders. */
const replaceHistoryUrl = (path: string): void =>
  window.history.replaceState(null, "", path);

/**
 * Ontology page root. One cluster per page; columns are container objects whose
 * children are cards. Edits persist through use-ontology. Active cluster is
 * URL-addressed by slug via replaceState, so tab flips don't remount the page.
 */
export function OntologyView({
  workspaceId,
  workspaceSegment,
  initialClusterSlug,
  pinnedClusterId,
  switcher = "pills",
  onSelectCluster,
  headerStart,
  headerEnd,
  canManageBilling = false,
  canEdit = true,
  replaceUrl = replaceHistoryUrl,
}: Props) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Declared above the store: the store's delete callback refreshes it.
  const ent = useWorkspaceEntitlements(workspaceId);
  const { isCapped, refresh } = ent;
  // Cap is a server-side count: only moves once the write has landed.
  const refreshCap = useCallback(() => {
    if (isCapped) void refresh();
  }, [isCapped, refresh]);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Create renders rows under PROVISIONAL ids, swapped when the POST answers.
  // ⚠ Selection is local state and must move with them, else board + panel
  // blank out exactly when the create succeeds.
  const handleIdsResolved = useCallback((map: Readonly<Record<string, string>>) => {
    setClusterId((id) => (id ? (map[id] ?? id) : id));
    setSelectedId((id) => (id ? (map[id] ?? id) : id));
  }, []);
  const { graph, status, dispatch, createCluster, createObject, pendingIds } = useOntology(
    workspaceId,
    {
      onOverCap: () => setUpgradeOpen(true),
      onDeleted: refreshCap,
      onCreated: refreshCap,
      onIdsResolved: handleIdsResolved,
    }
  );
  const [confirmDeleteCluster, setConfirmDeleteCluster] = useState(false);

  // ⚠ THE PIN OUTRANKS ALL THREE FALLBACKS AND HAS NONE OF ITS OWN — see the
  // prop's docblock.
  const cluster = pinnedClusterId
    ? (graph.clusters.find((c) => c.id === pinnedClusterId) ?? null)
    : (graph.clusters.find((c) => c.id === clusterId) ??
      graph.clusters.find((c) => c.slug === initialClusterSlug) ??
      graph.clusters[0] ??
      null);
  const selected = selectedId ? (graph.objects[selectedId] ?? null) : null;
  const clusterPending = cluster ? pendingIds.has(cluster.id) : false;
  // ⚠ ONE list for BOTH picker faces, walked once per graph — never per render
  // and never per face (`cluster-switcher.tsx`).
  const entries = useMemo(() => clusterSwitcherEntries(graph), [graph]);

  const selectCluster = (id: string) => {
    setClusterId(id);
    setSelectedId(null);
    setConfirmDeleteCluster(false);
    // ⚠ BESIDE the local write, not instead of it: a PINNED host resolves the
    // cluster from its own state, and an unpinned one from `clusterId`.
    onSelectCluster?.(id);
  };

  // ⚠ Effect, not inline in `selectCluster`: an optimistic cluster is selected
  // BEFORE it has a slug (server mints it, arrives via `CREATE_RESOLVE`). Keyed
  // on slug alone — stable across renames, and an unselected cluster (deep
  // link, first-cluster fallback) leaves the URL untouched.
  // ⚠ NEVER IN PINNED MODE: the host has no URL for the slug to follow.
  const activeSlug =
    !pinnedClusterId && cluster && cluster.id === clusterId ? cluster.slug : null;
  useEffect(() => {
    if (activeSlug) replaceUrl(`/${workspaceSegment}/ontology/${activeSlug}`);
  }, [activeSlug, workspaceSegment, replaceUrl]);

  // Permanent cascading delete. Selection moves to the ADJACENT tab (next,
  // else previous), never index 0: the `?? clusters[0]` display fallback would
  // land on an unrelated board (skills-browser-core `handleDeleted` pattern).
  const handleDeleteCluster = () => {
    if (!cluster) return;
    const at = graph.clusters.findIndex((c) => c.id === cluster.id);
    const neighbour = graph.clusters[at + 1] ?? graph.clusters[at - 1] ?? null;
    dispatch({ type: "CLUSTER_DELETE", id: cluster.id });
    setConfirmDeleteCluster(false);
    if (neighbour) {
      selectCluster(neighbour.id);
      return;
    }
    // Last cluster: drop the dead slug so a reload doesn't deep-link at it.
    setClusterId(null);
    setSelectedId(null);
    replaceUrl(`/${workspaceSegment}/ontology`);
  };

  // ⚠ New cluster creates TWO objects (column + first card) → needs headroom
  // of 2, not just under-cap. Otherwise a create at 999/1000 trips the server
  // cap mid-sequence and leaves an orphaned partial cluster.
  const handleCreateCluster = () => {
    if (
      ent.overCap ||
      (ent.isCapped &&
        ent.objectCap !== null &&
        ent.objectsUsed + 2 > ent.objectCap)
    ) {
      setUpgradeOpen(true);
      return;
    }
    // Synchronous: tab + column + first card land in the reducer before this
    // returns, so the board switches in the same frame as the click.
    selectCluster(createCluster().id);
  };

  // Cards inherit column's template fields, relationships, actions —
  // server-side, mirrored locally for the pending row.
  const handleCreateObject = (
    target: { clusterId: string } | { parentObjectId: string }
  ) => {
    if (ent.overCap) {
      setUpgradeOpen(true);
      return;
    }
    setSelectedId(createObject(target).id);
  };

  if (status === "loading") {
    return (
      <Frame>
        <OntologyBoardSkeleton />
      </Frame>
    );
  }
  if (status === "error") {
    return (
      <Frame>
        <p className="m-auto text-lead text-danger">
          Couldn&apos;t load the ontology. Refresh to retry.
        </p>
      </Frame>
    );
  }
  if (pinnedClusterId && !cluster) {
    // ⚠ ONE LINE, and it is not the empty state below: "there are none" and
    // "the one you opened is gone" are different answers, and the create button
    // under the second would make an unrelated ontology.
    return (
      <Frame>
        <p className="m-auto text-lead text-text-secondary">
          This ontology is no longer here.
        </p>
      </Frame>
    );
  }
  if (graph.clusters.length === 0) {
    return (
      <Frame>
        <div className="m-auto flex flex-col items-center gap-3">
          <p className="text-lead text-text-secondary">
            {canEdit
              ? "No ontology yet — start with your first cluster."
              : "No ontology yet — a workspace member can create the first cluster."}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={handleCreateCluster}
              className="auth-btn-3d rounded-lg px-4 py-2 text-lead font-semibold text-white"
            >
              New cluster
            </button>
          )}
        </div>
      </Frame>
    );
  }
  if (!cluster) return <Frame />;

  return (
    <OntologyResourcesProvider workspaceId={workspaceId} graph={graph}>
      <Frame>
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
          {/* ⚠ THE PICKER IS THE LEFT SLOT. `"pills"` in pinned mode is NO
              picker — the strip is a chooser for a board showing one thing;
              `"dropdown"` is one, which is what /home mounts. */}
          {(switcher === "dropdown" || !pinnedClusterId) && (
            <ClusterSwitcher
              mode={switcher}
              entries={entries}
              activeId={cluster.id}
              pendingIds={pendingIds}
              canEdit={canEdit}
              onSelect={selectCluster}
              onCreate={handleCreateCluster}
            />
          )}
          {headerStart}
          {/* ⚠ Inert until cluster is real: an edit on a provisional row would
              debounce a PATCH at an id the server has never seen. */}
          <div {...pendingRow(clusterPending, "flex min-w-0 flex-1 items-baseline gap-2")}>
            <input
              type="text"
              value={cluster.name}
              onChange={(e) =>
                dispatch({ type: "CLUSTER_UPDATE", id: cluster.id, patch: { name: e.target.value } })
              }
              aria-label="Cluster name"
              className="w-40 shrink-0 bg-transparent text-title font-semibold tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
              placeholder="Cluster name"
            />
            <input
              type="text"
              value={cluster.purpose}
              onChange={(e) =>
                dispatch({
                  type: "CLUSTER_UPDATE",
                  id: cluster.id,
                  patch: { purpose: e.target.value },
                })
              }
              aria-label="Cluster purpose"
              className="min-w-0 flex-1 bg-transparent text-body text-text-secondary placeholder:text-text-muted focus:outline-none"
              placeholder="What this ontology anchors (agents read this to route)…"
            />
          </div>
          {canEdit && !pinnedClusterId && (
            <button
              type="button"
              aria-label={`Delete ${cluster.name || "cluster"}`}
              title="Delete cluster"
              onClick={() => setConfirmDeleteCluster(true)}
              {...pendingRow(
                clusterPending,
                "btn-light flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-text-primary"
              )}
            >
              <Trash2 size={11} />
            </button>
          )}
          {headerEnd}
          {canEdit && (
            <button
              type="button"
              onClick={() => handleCreateObject({ clusterId: cluster.id })}
              {...pendingRow(
                clusterPending,
                "btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary"
              )}
            >
              <Plus size={12} /> Column
            </button>
          )}
        </div>

        {!ent.loading && ent.isCapped && ent.objectCap !== null && (
          <CapNotice
            used={ent.objectsUsed}
            cap={ent.objectCap}
            over={ent.overCap}
            onUpgrade={() => setUpgradeOpen(true)}
          />
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <KanbanBoard
            cluster={cluster}
            graph={graph}
            dispatch={dispatch}
            selectedId={selectedId}
            pendingIds={pendingIds}
            canEdit={canEdit}
            onSelect={setSelectedId}
            onCreateObject={(columnId) => handleCreateObject({ parentObjectId: columnId })}
          />
          {selected && selectedId && (
            <ObjectPanel
              workspaceId={workspaceId}
              objectId={selectedId}
              graph={graph}
              dispatch={dispatch}
              pending={pendingIds.has(selectedId)}
              canEdit={canEdit}
              onSelectObject={setSelectedId}
              onDeleteObject={(id) => dispatch({ type: "OBJECT_DELETE", id })}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </Frame>

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        workspaceId={workspaceId}
        canManageBilling={canManageBilling}
        reason={
          ent.objectCap !== null
            ? `This workspace hit the Starter limit of ${ent.objectCap.toLocaleString()} ontology objects. Nothing was deleted — upgrade to keep adding.`
            : undefined
        }
      />

      <DeleteClusterDialog
        open={confirmDeleteCluster}
        onOpenChange={setConfirmDeleteCluster}
        graph={graph}
        cluster={cluster}
        onConfirm={handleDeleteCluster}
      />
    </OntologyResourcesProvider>
  );
}

/** Floats the surface as ONE raised card via the global .page-float. */
function Frame({ children }: { children?: React.ReactNode }) {
  return (
    <div className="page-float flex flex-col antialiased">{children}</div>
  );
}
