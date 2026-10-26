"use client";

import { createPortal } from "react-dom";
import { StatusPill } from "@/shared/ui/status-pill";
import { containerNameOf, type GraphState } from "../graph-state";
import type { OntologyObject } from "../types";
import { FieldList } from "./field-list";
import { CHIP_TEXT, VALUE_CHIP } from "./ontology-bits";

/** Fields the quick view lists before "+N more". */
const HOVER_FIELDS = 6;

/** Cursor-following quick view: a white card portalled at cursor + 14px, clamped to the viewport,
 *  `pointer-events-none`. */
export function ObjectHoverCard({
  object,
  graph,
  x,
  y,
}: {
  object: OntologyObject;
  graph: GraphState;
  x: number;
  y: number;
}) {
  if (typeof document === "undefined") return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const containerName = containerNameOf(graph, object.id);

  return createPortal(
    <div
      className="white-card pointer-events-none fixed z-[9999] w-[22rem] max-w-[80vw] overflow-hidden shadow-[var(--shadow-card-lift)]"
      style={{ left: Math.min(x + 14, vw - 366), top: Math.min(y + 14, vh - 340) }}
    >
      <div className="flex items-center gap-2 px-3.5 pt-3">
        <span className="min-w-0 flex-1 truncate text-title font-medium text-text-primary">
          {object.name}
        </span>
        {containerName && <StatusPill>{containerName}</StatusPill>}
      </div>
      <div className="max-h-72 space-y-2 overflow-hidden px-3.5 pt-1 pb-3">
        {object.subtitle && (
          <p className="text-caption leading-snug text-text-secondary">{object.subtitle}</p>
        )}
        <FieldList
          object={object}
          graph={graph}
          limit={HOVER_FIELDS}
          className="border-t border-border-subtle"
        />
        {object.methods.length > 0 && (
          <p className="text-caption text-text-primary">
            <span className="text-text-muted">Actions</span>{" "}
            {object.methods.map((m) => m.name).join(" · ")}
          </p>
        )}
        {object.childIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {object.childIds.map((childId) => {
              const child = graph.objects[childId];
              if (!child) return null;
              return (
                <span key={childId} className={VALUE_CHIP}>
                  <span className={CHIP_TEXT}>{child.name}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
