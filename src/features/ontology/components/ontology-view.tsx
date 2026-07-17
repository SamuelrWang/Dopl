"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import { cn } from "@/shared/lib/utils";
import { useOntology } from "../hooks/use-ontology";
import { OntologyResourcesProvider } from "../hooks/use-workspace-resources";
import { CapNotice } from "./cap-notice";
import { KanbanBoard } from "./kanban-board";
import { ObjectPanel } from "./object-panel";

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
}

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
}: Props) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { graph, status, dispatch, createCluster, createObject } = useOntology(
    workspaceId,
    () => setUpgradeOpen(true)
  );
  const ent = useWorkspaceEntitlements(workspaceId);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cluster =
    graph.clusters.find((c) => c.id === clusterId) ??
    graph.clusters.find((c) => c.slug === initialClusterSlug) ??
    graph.clusters[0] ??
    null;
  const selected = selectedId ? (graph.objects[selectedId] ?? null) : null;

  const selectCluster = (id: string) => {
    setClusterId(id);
    setSelectedId(null);
    const slug = graph.clusters.find((c) => c.id === id)?.slug;
    if (slug) {
      window.history.replaceState(null, "", `/${workspaceSegment}/ontology/${slug}`);
    }
  };

  // A new cluster creates two objects (a column + its first card), so it
  // needs headroom of 2. Pre-check that — not just the exact cap — so the
  // create can't pass at 999/1000 then trip the server cap mid-sequence,
  // leaving an orphaned partial cluster behind a raw error toast. Over the
  // cap (or without room for both), open the upgrade prompt instead.
  const handleCreateCluster = async () => {
    if (
      ent.overCap ||
      (ent.isCapped &&
        ent.objectCap !== null &&
        ent.objectsUsed + 2 > ent.objectCap)
    ) {
      setUpgradeOpen(true);
      return;
    }
    const created = await createCluster();
    if (created) selectCluster(created.id);
    if (ent.isCapped) ent.refresh();
  };

  // Cards inherit the column's template fields, relationships, and
  // actions server-side.
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
        <p className="m-auto text-lead text-text-muted">Loading ontology…</p>
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
              onClick={() => handleCreateObject({ clusterId: cluster.id })}
              className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary"
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
            canEdit={canEdit}
            onSelect={setSelectedId}
            onCreateObject={(columnId) => handleCreateObject({ parentObjectId: columnId })}
          />
          {selected && selectedId && (
            <ObjectPanel
              objectId={selectedId}
              graph={graph}
              dispatch={dispatch}
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
            ? `This workspace hit the Free limit of ${ent.objectCap.toLocaleString()} ontology objects. Nothing was deleted — upgrade to keep adding.`
            : undefined
        }
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
