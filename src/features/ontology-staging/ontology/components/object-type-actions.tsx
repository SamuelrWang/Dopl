"use client";

import { useState, type Dispatch } from "react";
import { MoreHorizontal, Plus, Settings2, Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import {
  orphanedByObjectDelete,
  type GraphAction,
  type GraphState,
} from "@/features/ontology/graph-state";
import type { OntologyObject } from "@/features/ontology/types";
import { deleteObjectMessage } from "./object-panel";

/** The type header's glyph buttons: the naked icon at the header line's tighter box. */
export const TYPE_ICON_BUTTON = cn(NAKED_ICON_BUTTON, "p-1.5");

/**
 * An object type's trailing controls, shared by the canvas lane header and the rows group header:
 * `+` adds an object of the type, `⋯` opens the type's settings or deletes it behind a confirm.
 * Clicks stop here, so a header that toggles on click never toggles from these.
 */
export function ObjectTypeActions({
  column,
  label,
  graph,
  dispatch,
  onSelect,
  onCreateObject,
}: {
  column: OntologyObject;
  /** The type's display name (a placeholder when it has none). */
  label: string;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="flex shrink-0 items-center" data-clickable="" onClick={(e) => e.stopPropagation()}>
      {/* `Add to <name>`: `Add <name>` is the lane foot's button. */}
      <button
        type="button"
        aria-label={`Add to ${label}`}
        title={`Add to ${label}`}
        onClick={() => onCreateObject(column.id)}
        className={TYPE_ICON_BUTTON}
      >
        <Plus size={NAKED_ICON} />
      </button>
      <div className="relative">
        <button
          type="button"
          aria-label={`Object actions for ${label}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className={TYPE_ICON_BUTTON}
        >
          <MoreHorizontal size={NAKED_ICON} />
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
