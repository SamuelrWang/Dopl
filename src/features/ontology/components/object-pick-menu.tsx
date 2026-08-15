"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import type { GraphState } from "../graph-state";
import { PickMenu, type PickMenuItem } from "./pick-menu";

/**
 * THE object picker — `PickMenu` fed from the graph: columns under a "Columns"
 * group, cards grouped by their column's name. ⚠ Every place that links objects
 * (relationship targets, ref attributes) renders this, never a bespoke dropdown.
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
  for (const cluster of graph.clusters) {
    for (const colId of cluster.columnIds) {
      const col = graph.objects[colId];
      if (!col) continue;
      const colName = col.name || "Untitled column";
      items.push({ id: col.id, name: colName, group: "Columns" });
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
