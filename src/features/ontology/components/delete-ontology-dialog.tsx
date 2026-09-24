"use client";

import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { ontologyObjectIds, type GraphState } from "../graph-state";
import type { Ontology } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  graph: GraphState;
  ontology: Ontology;
  onConfirm: () => void;
}

/**
 * Confirm gate for a cascade ontology delete. Must name the ontology and the exact
 * object count — the count is the only thing telling the user a "ontology" delete
 * is really a board delete.
 */
export function DeleteOntologyDialog({
  open,
  onOpenChange,
  graph,
  ontology,
  onConfirm,
}: Props) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete ontology?"
      description={deleteOntologyMessage(
        ontology.name,
        ontologyObjectIds(graph, ontology.id).length
      )}
      confirmLabel="Delete permanently"
      destructive
      onConfirm={onConfirm}
    />
  );
}

/** Confirm copy: names the ontology + how many objects go with it (columns +
 *  nested cards). `count` = the same cascade set the server deletes. */
function deleteOntologyMessage(name: string, count: number): string {
  const label = name || "this ontology";
  if (count === 0) {
    return `This permanently deletes "${label}". This can't be undone.`;
  }
  return `This permanently deletes "${label}" and its ${count} object${count === 1 ? "" : "s"}. This can't be undone.`;
}
