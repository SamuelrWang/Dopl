"use client";

/**
 * THE ROWS DISPLAY'S GROUP HEADER (Samuel, 2026-10-22, ask 5b).
 *
 * ⚠ A NEW FILE RATHER THAN A BRANCH INSIDE `kanban-column-header.tsx`, on
 * purpose: that component is the CANVAS lane's header card and this round is
 * "when the user is on the row view just overhaul this". A `rows` prop in there
 * would put the two displays' geometry in one component and the next Canvas
 * change would have to reason about both. Canvas keeps its file byte-identical.
 *
 * WHAT THIS REPLACES. In Rows the old header was `KanbanColumnHeader` boxed at
 * `max-w-[264px]` — a white card marooned at the left of a full-width grey
 * panel — with the lane's fold chevron stranded at the far right of that panel,
 * and the type's description hidden behind a SECOND disclosure inside the card
 * that also showed a read-only echo of the template. Three affordances for one
 * object type, two of them folds.
 *
 * WHAT IT IS NOW, element by element (Samuel's philosophy ask: what needs
 * displaying, what, how, where, and the arrangement):
 *  - FOLD, first and leftmost. The handle sits where the thing it folds begins.
 *  - NAME, 15px/500, editable in place. It is the group's heading, so it is the
 *    biggest type on the line.
 *  - COUNT, muted, tabular. A fact about the type, not a badge.
 *  - DESCRIPTION, inline after the name, editable in place, taking the slack.
 *    It was worth a disclosure only because it had nowhere to sit.
 *  - CONTROLS, trailing and in one group: add, then the kebab. Where a reader
 *    looks for the controls of a row they are scanning.
 *  - The template echo is GONE from here. It is read-only and the editor is the
 *    object panel's `TemplateEditor` ("Object settings" in the kebab, one click
 *    away), so a second lossy copy of it on the board was a surface to maintain,
 *    not information.
 *
 * Nothing is a `<button>` inside a `<button>`: the row is a plain flex line and
 * every control is its own sibling, as in the file this replaces.
 */

import { useState } from "react";
import { MoreHorizontal, Plus, Settings2, Trash2 } from "lucide-react";
import type { Dispatch } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import {
  orphanedByObjectDelete,
  type GraphAction,
  type GraphState,
} from "@/features/ontology/graph-state";
import { NEW_COLUMN_NAME } from "@/features/ontology/optimistic-create";
import type { OntologyObject } from "@/features/ontology/types";
import { deleteObjectMessage } from "./object-panel";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * ⚠ `.trim()`, NOT `||` — a whitespace-only name is truthy. Found by Identity
   * Cards' blind read, 2026-10-24: `column.name || NEW_COLUMN_NAME` let `"   "`
   * through, so every aria-label here and the delete dialog's title rendered
   * blank for a type the operator had "named" with spaces.
   *
   * The idiom was already in the sibling file — `ontology-row.tsx` guards its
   * field keys with `row.label.trim() === ""` — and this file did not use it.
   * ⚠ Both halves were in front of the reader who read this file in FULL and
   * blind, and they did not connect them (their own note). Independence and
   * thoroughness are different axes; a blind read is not a careful one.
   */
  const label = column.name.trim() === "" ? NEW_COLUMN_NAME : column.name;

  return (
    <div className="uis-ont-grouphead">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
        title={open ? "Collapse" : "Expand"}
        className="uis-ont-icon"
      >
        <RowsChevron open={open} size={14} />
      </button>

      {/* ⚠ A VIEWER GETS TEXT, NOT A DISABLED FIELD. Found by Identities
          Polish's read, 2026-10-24: these were `<input readOnly={!canEdit}>`,
          which left a viewer a focusable box with a live "Description"
          placeholder — it advertised that they could type and then silently
          refused, while the add button and the kebab beside it were correctly
          withheld entirely. Two treatments of one permission in one component.
          Rendering the value as a span keeps the geometry (same classes) and
          keeps the promise. */}
      {canEdit ? (
        <input
          type="text"
          value={column.name}
          onChange={(e) =>
            dispatch({ type: "OBJECT_UPDATE", id: column.id, patch: { name: e.target.value } })
          }
          placeholder="Object name"
          aria-label="Object name"
          className="uis-ont-grouphead-name"
          /* Grows with its text so the count sits against the name, not at a
             fixed tab stop: a 6-character type and a 24-character one both read
             as "<name> · <n>". ⚠ TWO MECHANISMS, DELIBERATELY: this attribute
             sets the base width from the content, and `max-width` in the sheet
             caps it so a long name still leaves the description room. Neither
             alone does the job. */
          size={Math.max(6, Math.min(32, (column.name.trim() === "" ? "Object name" : column.name).length))}
        />
      ) : (
        <span className="uis-ont-grouphead-name">{label}</span>
      )}
      <span className="uis-ont-grouphead-count">{column.childIds.length}</span>

      {canEdit ? (
        <input
          type="text"
          value={column.subtitle}
          onChange={(e) =>
            dispatch({ type: "OBJECT_UPDATE", id: column.id, patch: { subtitle: e.target.value } })
          }
          /* One word, not a sentence (INVARIANTS §5 — the kit's hint rule). */
          placeholder="Description"
          aria-label="Object description"
          className="uis-ont-grouphead-desc"
        />
      ) : (
        // No empty box and no placeholder when there is nothing to show: a
        // viewer with no description sees the name and the count, which is the
        // truth about this type.
        column.subtitle.trim() !== "" && (
          <span className="uis-ont-grouphead-desc">{column.subtitle}</span>
        )
      )}

      {canEdit && (
        <button
          type="button"
          aria-label={`Add to ${label}`}
          title={`Add to ${label}`}
          onClick={() => onCreateObject(column.id)}
          className="uis-ont-icon"
        >
          <Plus size={14} />
        </button>
      )}
      {canEdit && (
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label={`Object actions for ${label}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="uis-ont-icon"
          >
            <MoreHorizontal size={14} />
          </button>
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)} align="right">
            <MenuItem
              icon={<Settings2 size={12} />}
              onSelect={() => {
                setMenuOpen(false);
                onSelect(column.id);
              }}
            >
              Object settings
            </MenuItem>
            <MenuItem
              destructive
              icon={<Trash2 size={12} />}
              onSelect={() => {
                setMenuOpen(false);
                setConfirmDelete(true);
              }}
            >
              Delete object
            </MenuItem>
          </Popover>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete object?"
        description={deleteObjectMessage(
          column.name || "this object",
          orphanedByObjectDelete(graph, column.id).length
        )}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => dispatch({ type: "OBJECT_DELETE", id: column.id })}
      />
    </div>
  );
}
