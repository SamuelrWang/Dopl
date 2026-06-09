"use client";

import { Link2, Unlink } from "lucide-react";
import { useCanvas } from "../canvas-store";

/**
 * Tiny banner shown at the top of a KB or Skill detail panel when the
 * panel is inside a cluster. Lets the user detach explicitly without
 * dragging the panel out. Detach dispatches REMOVE_PANEL_FROM_CLUSTER;
 * the use-cluster-attachment-sync bridge picks up the diff and DELETEs
 * the junction row.
 */
export function ClusterAttachmentBanner({ panelId }: { panelId: string }) {
  const { state, dispatch } = useCanvas();
  const cluster = state.clusters.find((c) => c.panelIds.includes(panelId));
  if (!cluster) return null;

  return (
    <div className="flex items-center justify-between gap-2 border-b border-agent-on/15 bg-agent-on/[0.04] px-4 py-1.5 text-[11px] text-agent-on/85">
      <div className="flex items-center gap-1.5 truncate">
        <Link2 size={11} className="shrink-0" />
        <span className="truncate">
          Attached to cluster <strong>{cluster.name}</strong>
        </span>
      </div>
      <button
        type="button"
        onClick={() =>
          dispatch({ type: "REMOVE_PANEL_FROM_CLUSTER", panelId })
        }
        className="inline-flex shrink-0 items-center gap-1 rounded border border-agent-on/20 px-1.5 py-0.5 text-[10px] text-agent-on/85 transition-colors hover:bg-agent-on/10 hover:text-agent-on"
        title="Detach from cluster"
      >
        <Unlink size={9} />
        Detach
      </button>
    </div>
  );
}
