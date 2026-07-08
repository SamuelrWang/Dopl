"use client";

import { createPortal } from "react-dom";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import { containerNameOf, type GraphState } from "../graph-state";
import type { OntologyObject } from "../types";

/**
 * Cursor-following quick view for an object (study-notes verse-tooltip
 * pattern: fixed portal at cursor + 14px, clamped to the viewport,
 * pointer-events-none).
 */
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
  const { nameOf } = useWorkspaceResources();
  if (typeof document === "undefined") return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const containerName = containerNameOf(graph, object.id);

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] w-[22rem] max-w-[80vw] overflow-hidden rounded-xl border border-border-strong bg-white shadow-xl"
      style={{ left: Math.min(x + 14, vw - 366), top: Math.min(y + 14, vh - 340) }}
    >
      <div className="flex items-center gap-2 bg-card-surface-subtle px-3.5 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          {object.name}
        </span>
        <span className="flex-1" />
        {containerName && (
          <span className="rounded-full border border-border-strong bg-bg-inset px-2 py-px text-micro font-semibold text-text-secondary">
            {containerName}
          </span>
        )}
      </div>
      <div className="max-h-72 space-y-2.5 overflow-hidden p-3.5 text-lead">
        {object.subtitle && (
          <p className="leading-snug text-text-secondary">{object.subtitle}</p>
        )}
        {object.attributes.length > 0 && (
          <div className="space-y-1">
            {object.attributes.slice(0, 5).map((attr) => (
              <p key={attr.key} className="text-body leading-snug text-text-primary">
                <span className="font-semibold text-text-muted">{attr.label}</span>{" "}
                {attr.value.kind === "knowledge" || attr.value.kind === "skill"
                  ? attr.value.value
                      .map((id) => nameOf(id))
                      .filter(Boolean)
                      .join(", ") || "—"
                  : attr.value.kind === "ref"
                    ? attr.value.value
                        .map((id) => graph.objects[id]?.name)
                        .filter(Boolean)
                        .join(", ") || "—"
                    : attr.value.value || "—"}
              </p>
            ))}
            {object.attributes.length > 5 && (
              <p className="text-caption text-text-muted">
                +{object.attributes.length - 5} more attributes
              </p>
            )}
          </div>
        )}
        {object.relationships.length > 0 && (
          <div className="space-y-1">
            {object.relationships.map((rel) => (
              <p key={rel.label} className="text-body leading-snug text-text-primary">
                <span className="italic text-text-muted">{rel.label}</span>{" "}
                {rel.targetIds
                  .map((id) => graph.objects[id]?.name)
                  .filter(Boolean)
                  .join(", ")}
              </p>
            ))}
          </div>
        )}
        {object.methods.length > 0 && (
          <p className="text-body leading-snug text-text-primary">
            <span className="font-semibold text-text-muted">Actions</span>{" "}
            {object.methods.map((m) => m.name).join(" · ")}
          </p>
        )}
        {object.childIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {object.childIds.map((childId) => {
              const child = graph.objects[childId];
              if (!child) return null;
              return (
                <span
                  key={childId}
                  className="rounded-full border border-border-strong bg-bg-inset px-2 py-0.5 text-caption font-medium text-text-primary"
                >
                  {child.name}
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
