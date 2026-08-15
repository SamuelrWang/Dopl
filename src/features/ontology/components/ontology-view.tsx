"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import { cn } from "@/shared/lib/utils";
import { pendingRow } from "@/shared/ui/pending";
import { useOntology } from "../hooks/use-ontology";
import { OntologyResourcesProvider } from "../hooks/use-workspace-resources";
import { CapNotice } from "./cap-notice";
import { DeleteClusterDialog } from "./delete-cluster-dialog";
import { KanbanBoard } from "./kanban-board";
import { ObjectPanel } from "./object-panel";
import { OntologyBoardSkeleton } from "./ontology-skeleton";

interface Props {
  workspaceId: string;
  workspaceSegment: string;
  /** Deep-linked cluster (`/[ws]/ontology/[clusterSlug]`); first cluster when omitted. */
  initialClusterSlug?: string;
  /** Admin/owner — controls whether the upgrade prompt offers checkout. */
  canManageBilling?: boolean;
  /** Member+ — viewers can read the ontology but can't create, so their
   *  create affordances (New cluster / Column / Add new) are hidden. */
  canEdit?: boolean;
  /**
   * How the address bar follows the active cluster's slug. Defaults to
   * `history.replaceState` with the path URL — what the Next app has always
   * done, and why the RSC pages pass nothing (a server component cannot hand a
   * function to a client component anyway).
   *
   * The desktop SPA injects its hash-router equivalent: the packaged renderer
   * is a `file://` document where replacing the path is a Chromium security
   * error, so the same intent has to travel through the router there. Same
   * seam.
   */
  replaceUrl?: (path: string) => void;
}

/** Module-level so the default is referentially stable across renders. */
const replaceHistoryUrl = (path: string): void =>
  window.history.replaceState(null, "", path);

/**
 * Ontology page root. One cluster per page; its columns are container
 * objects whose children are the cards. Selecting a card opens the
 * editor panel; every edit persists through use-ontology. The active
 * cluster is URL-addressed by slug (history.replaceState on switch, so
 * tab flips don't remount the page).
 */
export function OntologyView({
  workspaceId,
  workspaceSegment,
  initialClusterSlug,
  canManageBilling = false,
  canEdit = true,
  replaceUrl = replaceHistoryUrl,
}: Props) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Declared above the store: the store's delete callback refreshes it.
  const ent = useWorkspaceEntitlements(workspaceId);
  const { isCapped, refresh } = ent;
  // The cap is a server-side count, so it can only move once the delete has
  // landed — and deleting is the only way back under it.
  const refreshCap = useCallback(() => {
    if (isCapped) void refresh();
  }, [isCapped, refresh]);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A create puts its rows on screen under PROVISIONAL ids and swaps them for
  // the server's when the POST answers. Selection is this component's state, so
  // it has to move with them — otherwise the board and the panel blank out at
  // the moment the create succeeds, which reads as the create having failed.
  const handleIdsResolved = useCallback((map: Readonly<Record<string, string>>) => {
    setClusterId((id) => (id ? (map[id] ?? id) : id));
    setSelectedId((id) => (id ? (map[id] ?? id) : id));
  }, []);
  const { graph, status, dispatch, createCluster, createObject, pendingIds } = useOntology(
    workspaceId,
    {
      onOverCap: () => setUpgradeOpen(true),
      onDeleted: refreshCap,
      // The cap is a server-side count either way: it can only move once the
      // create has actually landed, not when its optimistic row appeared.
      onCreated: refreshCap,
      onIdsResolved: handleIdsResolved,
    }
  );
  const [confirmDeleteCluster, setConfirmDeleteCluster] = useState(false);

  const cluster =
    graph.clusters.find((c) => c.id === clusterId) ??
    graph.clusters.find((c) => c.slug === initialClusterSlug) ??
    graph.clusters[0] ??
    null;
  const selected = selectedId ? (graph.objects[selectedId] ?? null) : null;
  const clusterPending = cluster ? pendingIds.has(cluster.id) : false;

  const selectCluster = (id: string) => {
    setClusterId(id);
    setSelectedId(null);
    setConfirmDeleteCluster(false);
  };

  // The address bar follows the SELECTED cluster's slug, in an effect rather
  // than inside `selectCluster`, because an optimistically created cluster is
  // selected BEFORE it has a slug — the server mints that (uniqueness is a
  // table-wide question) and it arrives with `CREATE_RESOLVE`. Keyed on the
  // slug alone: slugs are stable across renames, so a rename does not churn
  // history, and a cluster the user has not explicitly selected (deep link,
  // first-cluster fallback) leaves the URL exactly as it found it.
  const activeSlug = cluster && cluster.id === clusterId ? cluster.slug : null;
  useEffect(() => {
    if (activeSlug) replaceUrl(`/${workspaceSegment}/ontology/${activeSlug}`);
  }, [activeSlug, workspaceSegment, replaceUrl]);

  // Permanent, cascading delete of the open cluster — the tab strip is where
  // clusters live, so it is where they end. Selection moves to the ADJACENT
  // tab (next, else previous), never to index 0: the `?? clusters[0]` display
  // fallback would land on an unrelated board and read as the app having
  // jumped on its own (skills-browser-core's handleDeleted pattern).
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
    // Last cluster: nothing left to address. Drop the dead slug from the URL
    // so a reload doesn't deep-link at a cluster that no longer exists.
    setClusterId(null);
    setSelectedId(null);
    replaceUrl(`/${workspaceSegment}/ontology`);
  };

  // A new cluster creates two objects (a column + its first card), so it
  // needs headroom of 2. Pre-check that — not just the exact cap — so the
  // create can't pass at 999/1000 then trip the server cap mid-sequence,
  // leaving an orphaned partial cluster behind a raw error toast. Over the
  // cap (or without room for both), open the upgrade prompt instead.
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
    // Synchronous: the tab, its column and its first card are in the reducer
    // before this returns, so the board switches to them in the same frame as
    // the click. The three POSTs settle behind the pending rows, and the cap
    // meter refreshes from `onCreated` when they land.
    selectCluster(createCluster().id);
  };

  // Cards inherit the column's template fields, relationships, and
  // actions — server-side, and mirrored locally for the pending row.
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
          {/* Trackless stadium pills — same language as SegmentedControl
              (.seg-pill resting, .raised-tab active); hand-composed because
              of the trailing new-cluster button and pending states. */}
          <div className="flex items-center gap-1.5">
            {graph.clusters.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCluster(c.id)}
                {...pendingRow(
                  pendingIds.has(c.id),
                  cn(
                    "flex h-[27px] items-center gap-1.5 rounded-full px-3 text-caption font-medium transition-colors",
                    c.id === cluster.id
                      ? "raised-tab text-text-primary"
                      : "seg-pill text-text-secondary hover:text-text-primary"
                  )
                )}
              >
                {c.name}
                <span className="text-micro text-text-muted">{c.columnIds.length}</span>
              </button>
            ))}
            {canEdit && (
              <button
                type="button"
                onClick={handleCreateCluster}
                aria-label="New cluster"
                className="flex h-[27px] w-[27px] items-center justify-center rounded-full text-text-muted transition hover:text-text-primary"
              >
                <Plus size={12} />
              </button>
            )}
          </div>
          {/* Inert until the cluster is real: an edit typed into a provisional
              row would debounce a PATCH at an id the server has never seen. */}
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
          {canEdit && (
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

/**
 * Floats the ontology surface as ONE raised card above the shell's
 * sidebar panel — the global .page-float surface (same as knowledge-v2).
 */
function Frame({ children }: { children?: React.ReactNode }) {
  return (
    <div className="page-float flex flex-col antialiased">{children}</div>
  );
}
