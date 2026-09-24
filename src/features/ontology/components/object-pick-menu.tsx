"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import type { GraphState } from "../graph-state";
import { PickMenu, type PickMenuItem } from "./pick-menu";

/**
 * The object picker — `PickMenu` fed from the graph: object types (the lanes) under
 * an "Objects" group, cards grouped by their lane's name. Every place that links
 * objects renders this, never a bespoke dropdown.
 */
export function ObjectPickMenu({
  graph,
  onPick,
  excludeIds,
  trigger,
  triggerClassName,
}: {
  graph: GraphState;
  onPick: (id: string) => void;
  excludeIds?: string[];
  trigger: ReactNode;
  triggerClassName?: string;
}) {
  const items = useMemo(() => buildItems(graph), [graph]);
  return (
    <PickMenu
      items={items}
      onPick={onPick}
      excludeIds={excludeIds}
      trigger={trigger}
      triggerClassName={triggerClassName}
    />
  );
}

function buildItems(graph: GraphState): PickMenuItem[] {
  const items: PickMenuItem[] = [];
  for (const ontology of graph.ontologies) {
    for (const colId of ontology.columnIds) {
      const col = graph.objects[colId];
      if (!col) continue;
      const colName = col.name || "Untitled object";
      items.push({ id: col.id, name: colName, group: "Objects" });
      for (const childId of col.childIds) {
        const child = graph.objects[childId];
        if (child) {
          items.push({ id: child.id, name: child.name || "Untitled", group: colName });
        }
      }
    }
  }
  return items;
}
