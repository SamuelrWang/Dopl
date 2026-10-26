"use client";

import type { Dispatch } from "react";
import type { GraphAction, GraphState } from "@/features/ontology/graph-state";
import { NEW_COLUMN_NAME } from "@/features/ontology/optimistic-create";
import type { OntologyObject } from "@/features/ontology/types";
import { ObjectTypeActions, TYPE_ICON_BUTTON } from "./object-type-actions";
import { RowsChevron } from "./rows-collapse";

interface Props {
  column: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  /** Viewers read the group but get no add / kebab affordances. */
  canEdit: boolean;
  /** Whether the group's records are shown (`use-rows-collapsed.ts`). */
  open: boolean;
  onToggleOpen: () => void;
  /** Opens the type itself in the right-side editor panel. */
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}

const NAME = "min-w-0 max-w-80 flex-none bg-transparent text-heading font-medium tracking-tight text-text-primary outline-none placeholder:text-text-muted";
const DESCRIPTION = "min-w-0 flex-1 truncate bg-transparent text-lead text-text-secondary outline-none placeholder:text-text-muted";

/**
 * The Rows display's group header, one line: fold, name, count, description (both edited in place),
 * then the type's actions. The Canvas lane's header is `kanban-column-header.tsx`. A viewer gets
 * text, never a read-only field that advertises typing.
 */
export function OntologyRowsGroupHeader({
  column,
  graph,
  dispatch,
  canEdit,
  open,
  onToggleOpen,
  onSelect,
  onCreateObject,
}: Props) {
  // `trim`, not `||`: a whitespace-only name is truthy.
  const label = column.name.trim() === "" ? NEW_COLUMN_NAME : column.name;

  return (
    <div className="flex min-h-7.5 items-center gap-2.5">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
        title={open ? "Collapse" : "Expand"}
        className={TYPE_ICON_BUTTON}
      >
        <RowsChevron open={open} size={14} />
      </button>

      {canEdit ? (
        <input
          type="text"
          value={column.name}
          onChange={(e) =>
            dispatch({ type: "OBJECT_UPDATE", id: column.id, patch: { name: e.target.value } })
          }
          placeholder="Object name"
          aria-label="Object name"
          className={NAME}
          // Grows with its text so the count sits against the name; `max-w-80` caps it.
          size={Math.max(6, Math.min(32, (column.name.trim() === "" ? "Object name" : column.name).length))}
        />
      ) : (
        <span className={NAME}>{label}</span>
      )}
      <span className="flex-none text-caption tabular-nums text-text-muted">
        {column.childIds.length}
      </span>

      {canEdit ? (
        <input
          type="text"
          value={column.subtitle}
          onChange={(e) =>
            dispatch({ type: "OBJECT_UPDATE", id: column.id, patch: { subtitle: e.target.value } })
          }
          placeholder="Description"
          aria-label="Object description"
          className={DESCRIPTION}
        />
      ) : (
        column.subtitle.trim() !== "" && <span className={DESCRIPTION}>{column.subtitle}</span>
      )}

      {canEdit && (
        <ObjectTypeActions
          column={column}
          label={label}
          graph={graph}
          dispatch={dispatch}
          onSelect={onSelect}
          onCreateObject={onCreateObject}
        />
      )}
    </div>
  );
}
