"use client";

import { useState } from "react";
import type { Dispatch } from "react";
import type { GraphAction, GraphState } from "@/features/ontology/graph-state";
import type { OntologyObject } from "@/features/ontology/types";
import { ObjectTypeActions, TYPE_ICON_BUTTON } from "./object-type-actions";
import { RowsChevron, RowsCollapse } from "./rows-collapse";
import { KIND_LABELS } from "./template-editor";

interface Props {
  column: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  /** Viewers read the column but get no add / menu affordances. */
  canEdit: boolean;
  /** The column itself is the object open in the editor panel. */
  selected: boolean;
  /** Opens the column in the right-side editor panel (full template editing). */
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}

/**
 * The canvas lane's header card: fold, name (edited in place), count, then the type's actions. It
 * unfolds onto the type's description and a read-only echo of its default fields; the editor is
 * the panel's.
 *
 * Not one button: the chevron is the keyboard toggle (`aria-expanded` + `aria-controls`) and the
 * row's `onClick` duplicates it for the mouse; every other control is a sibling that stops the click.
 */
export function KanbanColumnHeader({
  column,
  graph,
  dispatch,
  canEdit,
  selected,
  onSelect,
  onCreateObject,
}: Props) {
  const [open, setOpen] = useState(false);
  const label = column.name || "untitled object";
  const detailsId = `column-details-${column.id}`;

  return (
    <div
      className="white-card select-card shrink-0"
      data-selected={selected ? "true" : undefined}
    >
      {/* `data-clickable` is the row's hand cursor (`globals.css › ANYTHING CLICKABLE SHOWS THE
          HAND`); no `role`, since the row holds buttons of its own. */}
      <div
        className="flex items-center gap-1 py-1 pr-1 pl-1"
        data-clickable=""
        onClick={() => setOpen((v) => !v)}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${open ? "Hide" : "Show"} details for ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className={TYPE_ICON_BUTTON}
        >
          <RowsChevron open={open} size={13} />
        </button>
        <input
          type="text"
          value={column.name}
          readOnly={!canEdit}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            dispatch({ type: "OBJECT_UPDATE", id: column.id, patch: { name: e.target.value } })
          }
          className="min-w-0 flex-1 bg-transparent text-title font-medium tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
          placeholder="Object name"
          aria-label="Object name"
        />
        <span className="shrink-0 px-1 text-caption tabular-nums text-text-muted">
          {column.childIds.length}
        </span>
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

      <RowsCollapse id={detailsId} open={open}>
        <div className="border-t border-border-subtle px-3 pt-2 pb-3">
          <input
            type="text"
            value={column.subtitle}
            readOnly={!canEdit}
            onChange={(e) =>
              dispatch({
                type: "OBJECT_UPDATE",
                id: column.id,
                patch: { subtitle: e.target.value },
              })
            }
            placeholder="Describe this object…"
            className="w-full bg-transparent text-caption text-text-secondary placeholder:text-text-muted focus:outline-none"
            aria-label="Object description"
          />
          <TemplatePreview column={column} />
        </div>
      </RowsCollapse>
    </div>
  );
}

/** Read-only echo of the column's default fields — the editor is the panel's. */
function TemplatePreview({ column }: { column: OntologyObject }) {
  return (
    <>
      <p className="mt-3 text-caption font-medium text-text-muted">Default fields</p>
      {column.template.length === 0 ? (
        <p className="mt-1 text-caption text-text-muted">No template fields yet</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {column.template.map((field, i) => (
            <li
              key={`${field.key}-${i}`}
              className="flex min-h-7 items-center gap-2 border-t border-border-subtle first:border-t-0"
            >
              <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
                {field.label}
              </span>
              <span className="shrink-0 text-caption text-text-muted">
                {KIND_LABELS[field.kind]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
