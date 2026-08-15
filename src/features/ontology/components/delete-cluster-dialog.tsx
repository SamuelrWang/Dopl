"use client";

import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { clusterObjectIds, type GraphState } from "../graph-state";
import type { OntologyCluster } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  graph: GraphState;
  cluster: OntologyCluster;
  onConfirm: () => void;
}

/**
 * Confirm gate for a cascade cluster delete. ⚠ Must name the cluster AND the
 * exact object count — the count is the only thing telling the user a "cluster"
 * delete is really a board delete.
 */
export function DeleteClusterDialog({
  open,
  onOpenChange,
  graph,
  cluster,
  onConfirm,
}: Props) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete cluster?"
      description={deleteClusterMessage(
        cluster.name,
        clusterObjectIds(graph, cluster.id).length
      )}
      confirmLabel="Delete permanently"
      destructive
      onConfirm={onConfirm}
    />
  );
}

/** Confirm copy: names the cluster + how many objects go with it (columns +
 *  nested cards). `count` = the same cascade set the server deletes. */
function deleteClusterMessage(name: string, count: number): string {
  const label = name || "this cluster";
  if (count === 0) {
    return `This permanently deletes "${label}". This can't be undone.`;
  }
  return `This permanently deletes "${label}" and its ${count} object${count === 1 ? "" : "s"}. This can't be undone.`;
}
