"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import type { GraphState } from "../graph-state";
import type { AttributeValue } from "../types";
import { ObjectHoverCard } from "./object-hover-card";

interface Props {
  objectId: string;
  graph: GraphState;
  selected: boolean;
  onSelect: (id: string) => void;
}

/**
 * Compact card in a column. Click selects (opens the editor panel); the
 * chevron drops the card open inline with its attribute values.
 * Hovering shows the cursor-following quick view (suppressed while the
 * dropdown is open).
 */
export function KanbanCard({ objectId, graph, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const { nameOf } = useWorkspaceResources();
  const object = graph.objects[objectId];
  if (!object) return null;

  return (
    <div
      onMouseEnter={(e) => !open && setHoverPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => !open && setHoverPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setHoverPos(null)}
      className={cn(
        "overflow-hidden rounded-xl border bg-bg-elevated transition-shadow",
        selected
          ? "border-border-highlight shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.08)]"
          : "border-border-default shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.08)]"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(objectId)}
        className="flex w-full items-start gap-2 px-3 pt-2.5 pb-1 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-lead font-semibold tracking-tight text-text-primary">
            {object.name}
          </div>
          {object.subtitle && (
            <div className="mt-0.5 truncate text-caption text-text-secondary">
              {object.subtitle}
            </div>
          )}
        </div>
        <span
          role="button"
          tabIndex={0}
          aria-label={open ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            setHoverPos(null);
            setOpen((o) => !o);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setOpen((o) => !o);
            }
          }}
          className="rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
        >
          <ChevronDown
            size={13}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      <div className="flex items-center gap-2 px-3 pb-2 text-micro text-text-muted">
        <span>{object.attributes.length} attrs</span>
        <span aria-hidden>·</span>
        <span>{object.relationships.length} edges</span>
        <span aria-hidden>·</span>
        <span>{object.methods.length} actions</span>
      </div>

      {open && (
        <div className="border-t border-border-subtle bg-bg-inset px-3 py-2 shadow-[inset_0_2px_4px_rgba(0,0,0,0.08),inset_0_1px_2px_rgba(0,0,0,0.05)]">
          {object.attributes.length > 0 ? (
            <div className="flex flex-col gap-1">
              {object.attributes.slice(0, 5).map((attr) => (
                <div key={attr.key} className="flex items-baseline gap-2 text-caption">
                  <span className="w-24 shrink-0 truncate text-text-muted">
                    {attr.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-text-primary">
                    {previewValue(attr.value, graph, nameOf)}
                  </span>
                </div>
              ))}
              {object.attributes.length > 5 && (
                <span className="text-micro text-text-muted">
                  +{object.attributes.length - 5} more
                </span>
              )}
            </div>
          ) : (
            <p className="text-caption text-text-muted">No attributes yet.</p>
          )}
        </div>
      )}
      {hoverPos && !open && (
        <ObjectHoverCard object={object} graph={graph} x={hoverPos.x} y={hoverPos.y} />
      )}
    </div>
  );
}

function previewValue(
  value: AttributeValue,
  graph: GraphState,
  nameOf: (id: string) => string | null
): string {
  if (value.kind === "knowledge" || value.kind === "skill") {
    const names = value.value.map((id) => nameOf(id)).filter(Boolean);
    return names.length ? names.join(", ") : "—";
  }
  if (value.kind === "ref") {
    const names = value.value.map((id) => graph.objects[id]?.name).filter(Boolean);
    return names.length ? names.join(", ") : "—";
  }
  return value.value || "—";
}
