"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { toast } from "@/shared/ui/toast";
import { CapNotice } from "../components/cap-notice";
import { ObjectPanel } from "../components/object-panel";
import { clusterObjectIds } from "../graph-state";
import { ontologySnapshotKey, useOntology } from "../hooks/use-ontology";
import { OntologyResourcesProvider } from "../hooks/use-workspace-resources";
import { ONTOLOGY_EDGE_STYLES } from "./edge-styles";
import { OntologyGraphBody } from "./graph-body";
import { GraphSkeleton } from "./graph-skeleton";
import type { SceneEdgeKind } from "./types";

interface Props {
  workspaceId: string;
  /** Admin/owner — controls whether the upgrade prompt offers checkout. */
  canManageBilling?: boolean;
  /** Member+ — viewers read the graph but see no create/delete/add
   *  affordances, and the cluster name/purpose inputs are read-only. */
  canEdit?: boolean;
}

/**
 * Ontology graph page root (Canvas 2). One cluster per view: its
 * columns become lanes, their descendants node cards, with
 * containment / relationship / ref-attribute edges routed between
 * them. Selecting a node opens the real ObjectPanel editor; node
 * heights are measured live so edits re-route edges immediately.
 */
export function GraphView({ workspaceId, canManageBilling = false, canEdit = true }: Props) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const qc = useQueryClient();
  const { graph, status, dispatch, createCluster, createObject } = useOntology(
    workspaceId,
    () => setUpgradeOpen(true)
  );
  const ent = useWorkspaceEntitlements(workspaceId);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteCluster, setConfirmDeleteCluster] = useState(false);
  // Surfaced up from the keyed graph body: the reset-to-auto-layout fn, or
  // null when no node has been dragged. A thunk so setState doesn't invoke it.
  const [resetLayout, setResetLayout] = useState<(() => void) | null>(null);
  const handleLayoutResetChange = useCallback(
    (reset: (() => void) | null) => setResetLayout(() => reset),
    []
  );

  const cluster =
    graph.clusters.find((c) => c.id === clusterId) ?? graph.clusters[0] ?? null;

  // Anchor `clusterId` to a concrete cluster once loaded (never leave it null
  // relying on the `?? clusters[0]` display fallback — that fallback shifts
  // when a realtime snapshot reorders/deletes clusters, which is exactly how a
  // drag could persist to the wrong cluster). Also re-point it if the selected
  // cluster disappears remotely.
  useEffect(() => {
    if (graph.clusters.length === 0) return;
    if (clusterId === null || !graph.clusters.some((c) => c.id === clusterId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClusterId(graph.clusters[0]?.id ?? null);
    }
  }, [clusterId, graph.clusters]);

  // Selection survives only while the object exists — a delete (panel,
  // cluster cascade, remote) hides the panel and undims without an effect.
  const activeSelectedId = selectedId && graph.objects[selectedId] ? selectedId : null;

  // Layout-persist failures surface here (the body forwards the raised error):
  // toast + invalidate the snapshot so stored positions re-sync — mirrors
  // workflows' saveLayout instead of swallowing the rejection.
  const handleLayoutError = useCallback(
    (err: unknown) => {
      toast({
        title: "Couldn't save layout",
        description: err instanceof Error ? err.message : "Unknown error",
      });
      void qc.invalidateQueries({ queryKey: ontologySnapshotKey(workspaceId) });
    },
    [qc, workspaceId]
  );

  const selectCluster = (id: string) => {
    // No explicit flush needed: the graph body is keyed by cluster.id, so this
    // swap remounts it and its unmount flush lands any pending drag on the
    // OUTGOING cluster (correct closed-over persist target).
    setClusterId(id);
    setSelectedId(null);
    setConfirmDeleteCluster(false);
  };

  // A new cluster creates two objects (a column + its first card), so it
  // needs headroom of 2 — pre-check that, not just the exact cap, so the
  // create can't pass at 999/1000 then trip the server cap mid-sequence.
  // Over the cap (or without room for both), open the upgrade prompt.
  const handleCreateCluster = async () => {
    if (
      ent.overCap ||
      (ent.isCapped && ent.objectCap !== null && ent.objectsUsed + 2 > ent.objectCap)
    ) {
      setUpgradeOpen(true);
      return;
    }
    const created = await createCluster();
    if (created) selectCluster(created.id);
    if (ent.isCapped) ent.refresh();
  };

  const handleDeleteCluster = () => {
    if (!cluster) return;
    // The keyed body unmounts on this clusterId change and its unmount flush
    // lands any pending drag on the (about-to-be-deleted) cluster; a layout
    // write racing the soft-delete no-ops server-side (deleted_at guard).
    const remaining = graph.clusters.filter((c) => c.id !== cluster.id);
    dispatch({ type: "CLUSTER_DELETE", id: cluster.id });
    setClusterId(remaining[0]?.id ?? null);
    setSelectedId(null);
    setConfirmDeleteCluster(false);
  };

  const handleCreateObject = async (
    target: { clusterId: string } | { parentObjectId: string }
  ) => {
    if (ent.overCap) {
      setUpgradeOpen(true);
      return;
    }
    const object = await createObject(target);
    if (object) setSelectedId(object.id);
    if (ent.isCapped) ent.refresh();
  };

  if (status === "loading") {
    return (
      <Frame>
        <GraphSkeleton />
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
  if (graph.clusters.length === 0 || !cluster) {
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

  return (
    <OntologyResourcesProvider workspaceId={workspaceId} graph={graph}>
      <Frame>
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
          <div className="concave-track flex items-center gap-1">
            {graph.clusters.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCluster(c.id)}
                className={cn(
                  "flex h-6 items-center gap-1.5 rounded-[6px] px-2.5 text-caption font-medium transition-colors",
                  c.id === cluster.id
                    ? "raised-tab text-text-primary"
                    : "text-text-secondary hover:text-text-primary"
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
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-muted transition hover:text-text-primary"
              >
                <Plus size={12} />
              </button>
            )}
          </div>
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <input
              type="text"
              value={cluster.name}
              readOnly={!canEdit}
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
              readOnly={!canEdit}
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
              className="btn-light flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-text-primary"
            >
              <Trash2 size={11} />
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => handleCreateObject({ clusterId: cluster.id })}
              className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary"
            >
              <Plus size={12} /> Column
            </button>
          )}
          {canEdit && resetLayout && (
            <button
              type="button"
              onClick={resetLayout}
              title="Reset to auto layout"
              className="btn-light flex h-7 shrink-0 items-center rounded-md px-2.5 text-small font-medium text-text-primary"
            >
              Reset layout
            </button>
          )}
          <Legend />
        </div>

        {!ent.loading && ent.isCapped && ent.objectCap !== null && (
          <CapNotice
            used={ent.objectsUsed}
            cap={ent.objectCap}
            over={ent.overCap}
            onUpgrade={() => setUpgradeOpen(true)}
          />
        )}

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <OntologyGraphBody
            key={cluster.id}
            workspaceId={workspaceId}
            graph={graph}
            cluster={cluster}
            canEdit={canEdit}
            selectedId={activeSelectedId}
            onSelect={setSelectedId}
            onAddObject={handleCreateObject}
            onLayoutError={handleLayoutError}
            onLayoutResetChange={handleLayoutResetChange}
          />
          {activeSelectedId && (
            <div className="absolute inset-y-1 right-1 z-20 flex">
              <ObjectPanel
                objectId={activeSelectedId}
                graph={graph}
                dispatch={dispatch}
                canEdit={canEdit}
                onSelectObject={setSelectedId}
                onDeleteObject={(id) => dispatch({ type: "OBJECT_DELETE", id })}
                onClose={() => setSelectedId(null)}
              />
            </div>
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
            ? `This workspace hit the Free limit of ${ent.objectCap.toLocaleString()} ontology objects. Nothing was deleted — upgrade to keep adding.`
            : undefined
        }
      />

      <ConfirmDialog
        open={confirmDeleteCluster}
        onOpenChange={setConfirmDeleteCluster}
        title="Delete cluster"
        description={deleteClusterMessage(cluster.name, clusterObjectIds(graph, cluster.id).length)}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDeleteCluster}
      />
    </OntologyResourcesProvider>
  );
}

/**
 * Confirm copy for a cascade cluster delete — names the cluster and how many
 * objects go with it (its columns + all nested cards), and that it's
 * recoverable. `count` is the same cascade set the server soft-deletes.
 */
function deleteClusterMessage(name: string, count: number): string {
  const label = name || "this cluster";
  if (count === 0) {
    return `Delete "${label}"? You can restore it from trash.`;
  }
  return `Delete "${label}" and its ${count} object${count === 1 ? "" : "s"}? You can restore it from trash.`;
}

// Labels only — every swatch's stroke width / dash / color is read from the
// shared ONTOLOGY_EDGE_STYLES so the legend can never drift from the edges.
const LEGEND: Array<{ kind: SceneEdgeKind; label: string }> = [
  { kind: "containment", label: "contains" },
  { kind: "relationship", label: "relationship" },
  { kind: "ref", label: "ref" },
];

function Legend() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {LEGEND.map(({ kind, label }) => {
        const style = ONTOLOGY_EDGE_STYLES[kind];
        return (
          <span key={label} className="flex items-center gap-1.5">
            <svg width={20} height={6} aria-hidden className="overflow-visible">
              <line
                x1={0}
                y1={3}
                x2={20}
                y2={3}
                stroke={style.stroke}
                strokeWidth={style.width}
                strokeDasharray={style.dash}
              />
            </svg>
            <span className="text-micro text-text-muted">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The one raised .page-float card above the shell's sidebar panel. */
function Frame({ children }: { children?: React.ReactNode }) {
  return <div className="page-float flex flex-col antialiased">{children}</div>;
}
