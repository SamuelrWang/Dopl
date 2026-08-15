"use client";

import { useState } from "react";
import { pendingRow } from "@/shared/ui/pending";
import type { GraphState } from "../graph-state";
import { ObjectHoverCard } from "./object-hover-card";

interface Props {
  objectId: string;
  graph: GraphState;
  selected: boolean;
  /** Optimistically created, POST not answered: the card is the real content,
   *  dimmed and inert — its id is provisional and cannot be selected into. */
  pending?: boolean;
  onSelect: (id: string) => void;
}

/**
 * One object in a lane: name, description, hairline, counts. Whole card
 * selects; hover shows the cursor-following quick view. No inline expand —
 * attributes already render in the hover card and the panel.
 *
 * ⚠ FIXED HEIGHT is board arithmetic: `h-[216px]` = 18 × the 12px dot pitch
 * (the scale has no 216), against a 264px inner width.
 *
 * ⚠ The eight-line clamp is arithmetic, not taste: 216 − meta row (1px
 * hairline + 16px `py-2` + 14.7px micro line ≈ 32) − 20px body padding −
 * 18.75px name line − 2px gap ≈ 143px; `text-caption` is 11.5px × 1.4 =
 * 16.1px/line, so 8 lines (128.8px) is the last that fits with its ellipsis
 * (9 needs 144.9). Re-do the sum if height, paddings, lane padding or the type
 * scale move.
 *
 * ⚠ `<div>` + `onClick`, not a wrapping `<button>`: the title button is the
 * accessible control, the container handler is mouse convenience so the meta
 * row shares the target (see `knowledge-v2/home/base-card`).
 */
export function KanbanCard({
  objectId,
  graph,
  selected,
  pending = false,
  onSelect,
}: Props) {
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const object = graph.objects[objectId];
  if (!object) return null;

  return (
    <div
      onMouseEnter={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setHoverPos(null)}
      onClick={() => onSelect(objectId)}
      data-selected={selected ? "true" : undefined}
      {...pendingRow(
        pending,
        "kanban-card flex h-[216px] shrink-0 flex-col rounded-[10px] border bg-bg-elevated"
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(objectId);
        }}
        className="flex min-h-0 w-full flex-1 flex-col items-start px-3 pt-3 pb-2 text-left"
      >
        <span className="block w-full truncate text-body font-semibold tracking-tight text-text-primary">
          {object.name}
        </span>
        {/* Flexible middle: takes the space the fixed height leaves, clamps
            with ellipsis at the last fitting line. ⚠ No `block` beside the
            clamp — the clamp IS a display rule (-webkit-box) and whichever the
            stylesheet emitted last wins. */}
        {object.subtitle && (
          <span className="mt-0.5 line-clamp-[8] w-full min-h-0 flex-1 text-caption text-text-secondary">
            {object.subtitle}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border-subtle px-3 py-2 text-micro text-text-muted">
        <span>{object.attributes.length} attrs</span>
        <span aria-hidden>·</span>
        <span>{object.relationships.length} edges</span>
        <span aria-hidden>·</span>
        <span>{object.methods.length} actions</span>
      </div>

      {hoverPos && (
        <ObjectHoverCard object={object} graph={graph} x={hoverPos.x} y={hoverPos.y} />
      )}
    </div>
  );
}
