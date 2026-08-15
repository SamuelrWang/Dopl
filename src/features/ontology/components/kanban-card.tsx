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
 * One object in a lane: name, description, a hairline, then its counts.
 * The whole card selects (opening the editor panel), and hovering shows the
 * cursor-following quick view.
 *
 * ── FIXED HEIGHT, near-square but deliberately short of it. 216px against a
 *    264px inner width (the 288px lane less its 2 × 12px padding), so
 *    0.82 : 1. Written as `h-[216px]` rather than a scale step because the
 *    number is the board's arithmetic — 18 × the 12px dot pitch — and the
 *    scale has nothing at 216. The card is `base-card`'s structure in
 *    utilities: a head row, a description that FLEXES into whatever the fixed
 *    height leaves, and a meta row pinned to the bottom edge.
 *
 *    The eight-line clamp is arithmetic, not taste. 216 − the meta row (1px
 *    hairline + 16px `py-2` + a 14.7px micro line ≈ 32) − 20px of body
 *    padding − an 18.75px name line − the 2px gap leaves ≈ 143px, and
 *    `text-caption` is 11.5px × 1.4 = 16.1px per line: eight lines (128.8px)
 *    is the last one that fits with its ellipsis inside the box (nine would
 *    need 144.9). Re-do the sum if the height, the paddings, the lane padding
 *    or the type scale move.
 *
 * There is no inline expand any more (2026-08-12). The chevron dropped the
 * card open on an attribute preview that BOTH the hover card and the panel
 * already show — a third rendering of the same rows, and the one control on
 * the card that did not do what the card does.
 *
 * The card is a `<div>` with an `onClick`, not a `<button>` wrapping
 * everything: the title button is the accessible control (it carries the
 * object's name), and the container's handler is the mouse convenience that
 * lets the meta row be part of the same target. Same reasoning, at length, in
 * `knowledge-v2/home/base-card`.
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
        {/* The flexible middle, `base-card`'s `.cardDesc` in utilities: it
            takes the space the fixed height leaves and clamps with an
            ellipsis at the last line that fits. No `block` next to the clamp
            — the clamp IS a display rule (-webkit-box), and whichever of the
            two the stylesheet emitted last would win. An absent description
            leaves the space empty, exactly like an empty knowledge card. */}
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
