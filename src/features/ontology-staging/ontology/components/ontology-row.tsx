"use client";

import { Zap } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { pendingRow } from "@/shared/ui/pending";
import type { GraphState } from "@/features/ontology/graph-state";
import { FieldList } from "./field-list";
import { TYPE_ICON_BUTTON } from "./object-type-actions";
import { RowsChevron, RowsCollapse } from "./rows-collapse";

interface Props {
  objectId: string;
  graph: GraphState;
  selected: boolean;
  /** Optimistically created, POST not answered: drawn dimmed and inert. */
  pending?: boolean;
  onSelect: (id: string) => void;
  /** Folded = name line only. Persisted by the board (`use-rows-collapsed.ts`). */
  open?: boolean;
  onToggleOpen?: () => void;
}

/**
 * One object in the Rows display, the record card: name over description, every field on hairlines
 * (`field-list.tsx`), then the actions an agent can run on it. Mounted only by the Rows branch of
 * `kanban-board.tsx`.
 *
 * `<div>` + `onClick` with the name as the accessible button: the record holds controls of its own,
 * so it takes no `role="button"`.
 */
export function OntologyRow({
  objectId,
  graph,
  selected,
  pending = false,
  onSelect,
  open = true,
  onToggleOpen,
}: Props) {
  const object = graph.objects[objectId];
  if (!object) return null;

  return (
    <div
      onClick={(e) => {
        // A chip inside a value is its own control; neither should also open this record.
        if (e.target instanceof Element && e.target.closest("a,button")) return;
        onSelect(objectId);
      }}
      data-clickable=""
      data-selected={selected ? "true" : undefined}
      {...pendingRow(pending, "white-card select-card flex w-full shrink-0 flex-col")}
    >
      <div className="flex items-start">
        <button
          type="button"
          onClick={() => onSelect(objectId)}
          className="flex min-w-0 flex-1 flex-col items-start px-3.5 pt-3 pb-2.5 text-left"
        >
          <span className="w-full truncate text-heading font-medium tracking-tight text-text-primary">
            {object.name}
          </span>
          {object.subtitle && (
            <RowsCollapse open={open}>
              <span className="mt-0.5 line-clamp-2 w-full text-lead text-text-secondary">
                {object.subtitle}
              </span>
            </RowsCollapse>
          )}
        </button>
        {onToggleOpen && (
          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${object.name || "object"}`}
            title={open ? "Collapse" : "Expand"}
            className={cn(TYPE_ICON_BUTTON, "mt-2 mr-2")}
          >
            <RowsChevron open={open} size={13} />
          </button>
        )}
      </div>

      <RowsCollapse open={open}>
        <FieldList
          object={object}
          graph={graph}
          onSelect={onSelect}
          className="mx-3.5 border-t border-border-default"
        />
        {object.methods.length > 0 && (
          <div className="mx-3.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-border-default py-2.25">
            <span className="flex-none text-caption text-text-muted">Actions</span>
            {object.methods.map((m) => (
              <span
                key={m.name}
                className="inline-flex items-center gap-1 rounded-md border border-border-default bg-bg-overlay px-2 py-0.5 text-caption font-medium text-text-secondary"
                title={m.description || undefined}
              >
                <Zap size={10} aria-hidden className="flex-none text-text-muted" />
                {m.name}
              </span>
            ))}
          </div>
        )}
      </RowsCollapse>
    </div>
  );
}
