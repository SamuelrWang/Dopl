"use client";

import { useState } from "react";
import { pendingRow } from "@/shared/ui/pending";
import type { GraphState } from "../graph-state";
import { FieldList } from "./field-list";
import { ObjectHoverCard } from "./object-hover-card";

interface Props {
  objectId: string;
  graph: GraphState;
  selected: boolean;
  /** Optimistically created, POST not answered: the card is the real content, dimmed and inert —
   *  its id is provisional and cannot be selected into. */
  pending?: boolean;
  onSelect: (id: string) => void;
}

/** First fields a canvas card previews; the hover card and the panel carry the rest. */
const CARD_FIELDS = 3;

/**
 * One object in a canvas lane: a selectable white card with the name, description, the first few
 * fields and the counts. The whole card selects; hover shows the cursor-following quick view.
 *
 * `<div>` + `onClick`, not a wrapping `<button>`: the name button is the accessible control, and the
 * card holds controls of its own (a `ref` chip opens that object, a link opens the browser).
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
      onClick={(e) => {
        if (e.target instanceof Element && e.target.closest("a,button")) return;
        onSelect(objectId);
      }}
      // The base layer's clickable-cursor hook (`globals.css › ANYTHING CLICKABLE SHOWS THE HAND`).
      data-clickable=""
      data-selected={selected ? "true" : undefined}
      {...pendingRow(pending, "white-card select-card flex shrink-0 flex-col")}
    >
      <button
        type="button"
        onClick={() => onSelect(objectId)}
        className="flex w-full flex-col items-start px-3.5 pt-3 pb-2.5 text-left"
      >
        <span className="block w-full truncate text-title font-medium tracking-tight text-text-primary">
          {object.name}
        </span>
        {object.subtitle && (
          <span className="mt-0.5 line-clamp-3 w-full text-caption text-text-secondary">
            {object.subtitle}
          </span>
        )}
      </button>
      <FieldList
        object={object}
        graph={graph}
        onSelect={onSelect}
        limit={CARD_FIELDS}
        compact
        className="mx-3.5 border-t border-border-subtle"
      />
      <div className="mx-3.5 flex shrink-0 items-center gap-1.5 border-t border-border-subtle py-2 text-micro text-text-muted">
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
