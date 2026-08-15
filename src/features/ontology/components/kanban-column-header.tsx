"use client";

import { useState } from "react";
import { ChevronDown, MoreHorizontal, Plus, Settings2, Trash2 } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import {
  orphanedByObjectDelete,
  type GraphAction,
  type GraphState,
} from "../graph-state";
import type { OntologyObject } from "../types";
import { deleteObjectMessage } from "./object-panel";
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
 * The white header card at the top of a column's lane: the column name
 * (edited in place), its card count, and — for editors — an add button and
 * a kebab menu.
 *
 * Clicking the card expands it DOWNWARD onto a preview of what the column
 * is: its description, and the default fields every new card is born with.
 * Preview only — the template is EDITED in the right panel's TemplateEditor,
 * which the kebab's "Column settings" opens (it replaced the old gear).
 *
 * ── THE CARD IS NOT ONE BUTTON, for the reason `knowledge-v2/home/base-card`
 *    documents at length: a `<button>` inside a `<button>` is invalid HTML and
 *    browsers reparent the inner one OUT of the card. The name input and the
 *    two icon buttons are therefore SIBLINGS, the chevron is the real
 *    keyboard-operable toggle (`aria-expanded` + `aria-controls`), and the
 *    row's `onClick` is a MOUSE convenience that duplicates it rather than
 *    competing with it — every control on the row stops propagation so one
 *    click fires exactly one thing.
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const label = column.name || "untitled column";
  const detailsId = `column-details-${column.id}`;

  return (
    // No `overflow-hidden` on the card: the kebab's Popover is an absolutely
    // positioned child of this subtree and a clipping ancestor would cut the
    // menu off. Nothing inside paints its own background, so the rounded
    // corners hold without it.
    <div
      className="kanban-card shrink-0 rounded-[10px] border bg-bg-elevated"
      data-selected={selected ? "true" : undefined}
    >
      <div
        className="flex items-center gap-1 px-1.5 py-1"
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
          className="shrink-0 rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
        >
          <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
        </button>
        <input
          type="text"
          value={column.name}
          readOnly={!canEdit}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            dispatch({ type: "OBJECT_UPDATE", id: column.id, patch: { name: e.target.value } })
          }
          className="min-w-0 flex-1 bg-transparent text-body font-semibold tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
          placeholder="Column name"
          aria-label="Column name"
        />
        <span className="shrink-0 rounded-full bg-surface-raised-4 px-1.5 py-px text-micro font-medium text-text-secondary">
          {column.childIds.length}
        </span>
        {canEdit && (
          <button
            type="button"
            aria-label={`Add object to ${label}`}
            title="Add object"
            onClick={(e) => {
              e.stopPropagation();
              onCreateObject(column.id);
            }}
            className="shrink-0 rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
          >
            <Plus size={13} />
          </button>
        )}
        {canEdit && (
          <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label={`Column actions for ${label}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
            >
              <MoreHorizontal size={13} />
            </button>
            <Popover open={menuOpen} onClose={() => setMenuOpen(false)} align="right">
              <MenuItem
                icon={<Settings2 size={12} />}
                onSelect={() => {
                  setMenuOpen(false);
                  onSelect(column.id);
                }}
              >
                Column settings
              </MenuItem>
              <MenuItem
                destructive
                icon={<Trash2 size={12} />}
                onSelect={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              >
                Delete column
              </MenuItem>
            </Popover>
          </div>
        )}
      </div>

      {/* Smooth height collapse without measuring: the row animates 0fr → 1fr
          and the child clips itself. `inert` while closed so the hidden input
          is out of the tab order and off the accessibility tree — `overflow:
          hidden` alone hides it from sight only. */}
      <div
        id={detailsId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-[250ms] ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border-subtle px-2 pt-1.5 pb-2">
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
              placeholder="Describe this column…"
              className="w-full bg-transparent text-caption text-text-secondary placeholder:text-text-muted focus:outline-none"
              aria-label="Column description"
            />
            <TemplatePreview column={column} />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete column?"
        description={deleteObjectMessage(
          column.name || "this column",
          orphanedByObjectDelete(graph, column.id).length
        )}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => dispatch({ type: "OBJECT_DELETE", id: column.id })}
      />
    </div>
  );
}

/** Read-only echo of the column's default fields — the editor is the panel's. */
function TemplatePreview({ column }: { column: OntologyObject }) {
  return (
    <>
      <p className="mt-2 text-label font-semibold uppercase tracking-wide text-text-muted">
        Default fields
      </p>
      {column.template.length === 0 ? (
        <p className="mt-1 text-caption text-text-muted">No template fields yet</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {column.template.map((field, i) => (
            <li key={`${field.key}-${i}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
                {field.label}
              </span>
              <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
                {KIND_LABELS[field.kind]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
