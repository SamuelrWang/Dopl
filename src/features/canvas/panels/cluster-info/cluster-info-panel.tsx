"use client";

/**
 * ClusterInfoPanelBody — the workflow header card that fronts a cluster.
 *
 * Shows the cluster's editable name (UPPER_SNAKE, same normalization the
 * old header tab used) and description (capped at DESCRIPTION_MAX with a
 * counter, matching the doc-pane pattern). Both read live from
 * `state.clusters` and save via UPDATE_CLUSTER_INFO + a debounce-free
 * blur PATCH to /api/clusters/[slug] once the cluster has synced (slug
 * present). A trash affordance deletes the whole workflow (cluster +
 * this panel) through the shared ConfirmDialog.
 */

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { normalizeClusterName } from "@/shared/lib/cluster-name";
import { DESCRIPTION_MAX } from "@/config";
import { useCanvas, useCanvasScope } from "../../canvas-store";
import type { ClusterInfoPanelData } from "../../types";

export function ClusterInfoPanelBody({ panel }: { panel: ClusterInfoPanelData }) {
  const { state, dispatch } = useCanvas();
  const scope = useCanvasScope();
  const workspaceId = scope?.workspaceId ?? null;

  const cluster = state.clusters.find((c) => c.id === panel.clusterId) ?? null;

  const [name, setName] = useState(cluster?.name ?? "");
  const [description, setDescription] = useState(cluster?.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Latest cluster for the serialized patch queue — each queued PATCH
  // reads the slug at EXECUTION time, so a rename that regenerated the
  // slug can't strand the next patch on a stale slug (double-rename race).
  const clusterRef = useRef(cluster);
  clusterRef.current = cluster;
  const patchQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Edits made before the cluster has synced (no slug yet) accumulate
  // here and replay once the slug arrives.
  const pendingPatchRef = useRef<{
    name?: string;
    description?: string | null;
  } | null>(null);
  const nameFocusedRef = useRef(false);
  const descFocusedRef = useRef(false);

  // Re-seed local fields when the store changes underneath us (realtime
  // rename from another tab / an agent over MCP, upgrade synthesis) —
  // but never clobber a field the user is currently editing.
  useEffect(() => {
    if (!nameFocusedRef.current) setName(cluster?.name ?? "");
    if (!descFocusedRef.current) setDescription(cluster?.description ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.clusterId, cluster?.dbId, cluster?.name, cluster?.description]);

  // Replay edits that happened before the slug existed.
  useEffect(() => {
    if (!cluster?.slug || !pendingPatchRef.current) return;
    const body = pendingPatchRef.current;
    pendingPatchRef.current = null;
    patchClusterDb(body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster?.slug]);

  if (!cluster) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
        Cluster removed.
      </div>
    );
  }

  /** Persist name/description to the clusters table. Serialized per
   *  panel so concurrent edits execute in order against the freshest
   *  slug; pre-slug edits park in pendingPatchRef for the replay
   *  effect above. */
  function patchClusterDb(body: { name?: string; description?: string | null }) {
    patchQueueRef.current = patchQueueRef.current
      .then(() => executePatch(body))
      .catch(() => {
        toast({ title: "Couldn't save workflow details" });
      });
  }

  async function executePatch(body: {
    name?: string;
    description?: string | null;
  }): Promise<void> {
    const current = clusterRef.current;
    const slug = current?.slug;
    if (!current || !slug) {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...body };
      return;
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
    const res = await fetch(`/api/clusters/${slug}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { id?: string; slug?: string };
    // Renames regenerate the slug server-side — keep the store synced.
    if (data.id && data.slug && data.slug !== slug) {
      dispatch({
        type: "UPDATE_CLUSTER_DB_INFO",
        clusterId: current.id,
        dbId: data.id,
        slug: data.slug,
      });
    }
  }

  function commitName() {
    if (!cluster) return;
    const normalized = normalizeClusterName(name);
    if (!normalized || normalized === cluster.name) {
      setName(cluster.name);
      return;
    }
    setName(normalized);
    dispatch({
      type: "UPDATE_CLUSTER_INFO",
      clusterId: cluster.id,
      name: normalized,
    });
    patchClusterDb({ name: normalized });
  }

  function commitDescription() {
    if (!cluster) return;
    const next = description.trim();
    if (next === (cluster.description ?? "")) return;
    dispatch({
      type: "UPDATE_CLUSTER_INFO",
      clusterId: cluster.id,
      description: next === "" ? null : next,
    });
    patchClusterDb({ description: next === "" ? null : next });
  }

  async function handleDelete() {
    if (!cluster) return;
    if (cluster.slug) {
      const headers: Record<string, string> = {};
      if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
      let res: Response;
      try {
        res = await fetch(`/api/clusters/${cluster.slug}`, {
          method: "DELETE",
          headers,
        });
      } catch {
        toast({
          title: "Couldn't delete workflow",
          description: "Network error — try again.",
        });
        throw new Error("delete failed");
      }
      // 404 = the row is already gone (deleted elsewhere) — proceed
      // with the local removal. Other failures abort so the canvas
      // doesn't diverge from a clusters row agents still see.
      if (!res.ok && res.status !== 404) {
        toast({
          title: "Couldn't delete workflow",
          description: `Server said ${res.status} — try again.`,
        });
        throw new Error("delete failed");
      }
    }
    dispatch({ type: "DELETE_CLUSTER", clusterId: cluster.id });
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 pt-2.5 pb-3 gap-1.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          data-no-drag
          onChange={(e) => setName(e.target.value)}
          onFocus={() => {
            nameFocusedRef.current = true;
          }}
          onBlur={() => {
            nameFocusedRef.current = false;
            commitName();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label="Workflow name"
          placeholder="WORKFLOW_NAME"
          className="flex-1 min-w-0 bg-transparent font-mono text-[13px] font-semibold uppercase tracking-wide text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label="Delete workflow"
          title="Delete workflow"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-[3px] text-text-muted hover:text-danger hover:bg-surface-raised-3 transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <textarea
        value={description}
        data-no-drag
        onChange={(e) =>
          setDescription(e.target.value.slice(0, DESCRIPTION_MAX))
        }
        onFocus={() => {
          descFocusedRef.current = true;
        }}
        onBlur={() => {
          descFocusedRef.current = false;
          commitDescription();
        }}
        rows={3}
        maxLength={DESCRIPTION_MAX}
        aria-label="Workflow description"
        placeholder="Describe what this workflow does — agents see this when reading the cluster…"
        className="flex-1 min-h-0 resize-none bg-transparent text-[12px] leading-relaxed text-text-secondary placeholder:text-text-muted focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
          Workflow
        </span>
        <span className="font-mono text-[9px] text-text-muted">
          {description.length}/{DESCRIPTION_MAX}
        </span>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete workflow?"
        description={`“${cluster.name}” will be deleted. Panels inside it stay on the canvas; attached knowledge bases and skills are detached (not deleted).`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
