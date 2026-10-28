"use client";

import { useState, type Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import type { GraphAction, GraphState } from "../graph-state";
import type { OntologyObject } from "../types";
import {
  ObjectTypeActions,
  TYPE_ICON_BUTTON,
  TypeDefaultFields,
  typeLabel,
} from "./object-type-actions";
import { RowsChevron, RowsCollapse } from "./rows-collapse";

interface Props {
  column: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  /** Viewers read the group but get no add / kebab affordances. */
  canEdit: boolean;
  /** Whether the group's records are shown (`use-rows-collapsed.ts`). */
  open: boolean;
  onToggleOpen: () => void;
  /** The id of the records fold the chevron controls. */
  recordsId: string;
  /** Opens the type itself in the right-side editor panel. */
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}

const NAME = "min-w-0 max-w-80 flex-none bg-transparent text-lead font-medium tracking-tight text-text-primary outline-none placeholder:text-text-muted";
const DESCRIPTION = "min-w-0 flex-1 truncate bg-transparent text-lead text-text-secondary outline-none placeholder:text-text-muted";

/**
 * The Rows display's group header: fold, name, count, description (both edited in place), the
 * type's default fields behind their own read-only fold, then the type's actions. The Canvas lane's
 * header is `kanban-column-header.tsx`. A viewer gets text, never a read-only field that advertises
 * typing.
 */
export function OntologyRowsGroupHeader({
  column,
  graph,
  dispatch,
  canEdit,
  open,
  onToggleOpen,
  recordsId,
  onSelect,
  onCreateObject,
}: Props) {
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const label = typeLabel(column);
  const described = column.subtitle.trim() !== "";
  const { id } = column;
  const defaultsId = `type-defaults-${id}`;

  return (
    <div className="flex flex-col">
      <div className="flex min-h-7.5 items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          aria-controls={recordsId}
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
              dispatch({ type: "OBJECT_UPDATE", id, patch: { name: e.target.value } })
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
              dispatch({ type: "OBJECT_UPDATE", id, patch: { subtitle: e.target.value } })
            }
            placeholder="Description"
            aria-label="Object description"
            className={DESCRIPTION}
          />
        ) : (
          described && <span className={DESCRIPTION}>{column.subtitle}</span>
        )}

        <button
          type="button"
          onClick={() => setDefaultsOpen((v) => !v)}
          aria-expanded={defaultsOpen}
          aria-controls={defaultsId}
          aria-label={`${defaultsOpen ? "Hide" : "Show"} default fields for ${label}`}
          className={cn(TYPE_ICON_BUTTON, "ml-auto gap-1 text-caption")}
        >
          Default fields
          <RowsChevron open={defaultsOpen} size={12} />
        </button>

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

      <RowsCollapse id={defaultsId} open={defaultsOpen} className="max-w-96 pl-8.5">
        <TypeDefaultFields column={column} titled={false} />
      </RowsCollapse>
    </div>
  );
}
