"use client";

import { useState } from "react";
import { Trash2, X } from "lucide-react";
import type { Dispatch } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import { pendingRow } from "@/shared/ui/pending";
import {
  NAKED_ICON,
  NAKED_ICON_BUTTON,
} from "@/shared/ui/naked-icon-button";
import {
  containerNameOf,
  orphanedByObjectDelete,
  type GraphAction,
  type GraphState,
} from "../graph-state";
import { InlineUnderlineField } from "./board-header-bits";
import { ActionsEditor } from "./actions-editor";
import { ObjectHistory } from "./object-history";
import { AttributesEditor } from "./attributes-editor";
import { RelationshipsEditor } from "./relationships-editor";
import { TemplateEditor } from "./template-editor";

interface Props {
  objectId: string;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  onSelectObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
  onClose: () => void;
  /**
   * `objectId` is provisional (create POST unanswered). The panel opens at once but
   * stays inert for the round trip: every write here is aimed at the id, and a
   * provisional one has nowhere to land.
   */
  pending?: boolean;
  /** Member+ — viewers see no edit/delete affordances: inputs read-only,
   *  Delete hidden, child editors drop add/remove. */
  canEdit?: boolean;
  /** The container the history read is addressed to (`X-Workspace-Id`). Optional:
   *  History is absent without it rather than the panel guessing a container. */
  workspaceId?: string;
}

/**
 * Naked icons (Samuel, 2026-09-12): the two header controls carry no button face.
 * The 30px box is padding (`p-2`) around a 14px glyph, not a height — muted at
 * rest, primary on hover, no border, fill or shadow in any state.
 *
 * `docs/DESIGN-SYSTEM.md`'s F-345 forbids a seventh hand-written icon-button
 * string by name. It is IMPORTED here; the ruling above is unchanged.
 */


/** Right-side editor panel for the selected object (card or column): identity
 *  header, then attribute / relationship / action editors, all in place. */
export function ObjectPanel({
  objectId,
  graph,
  dispatch,
  onSelectObject,
  onDeleteObject,
  onClose,
  pending = false,
  canEdit = true,
  workspaceId,
}: Props) {
  const object = graph.objects[objectId];
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!object) return null;

  const isColumn = graph.clusters.some((c) => c.columnIds.includes(objectId));
  const containerName = containerNameOf(graph, objectId);

  return (
    <div
      {...pendingRow(
        pending,
        "my-2 mr-2 flex min-h-0 w-[420px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-border-highlight bg-bg-elevated shadow-[0_2px_6px_rgba(0,0,0,0.07),0_16px_40px_-10px_rgba(0,0,0,0.22)]"
      )}
    >
      {/* Top line is a name, not a pill, and carries no uuid (Samuel, 2026-09-12).
          It wears the board header name trigger's recipe so the two read as one
          vocabulary. For a card it names the object type the card is one of (its
          lane); for a lane there is no parent, so it states what the panel is and
          how many items the type has. The id is nowhere, not even in a `title`. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-card-surface-subtle px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-body font-medium text-text-primary">
          {isColumn ? `Object · ${object.childIds.length}` : containerName ?? "Object"}
        </span>
        {canEdit && (
          <button
            type="button"
            aria-label={`Delete ${object.name}`}
            title="Delete object"
            onClick={() => setConfirmDelete(true)}
            className={NAKED_ICON_BUTTON}
          >
            <Trash2 size={NAKED_ICON} />
          </button>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={NAKED_ICON_BUTTON}
        >
          <X size={NAKED_ICON} />
        </button>
      </div>

      <div className="min-h-0 grow overflow-y-auto overscroll-contain p-3">
        <div className="flex flex-col gap-4">
          <div>
            <input
              type="text"
              value={object.name}
              readOnly={!canEdit}
              onChange={(e) =>
                dispatch({ type: "OBJECT_UPDATE", id: objectId, patch: { name: e.target.value } })
              }
              className="w-full bg-transparent text-display font-semibold leading-snug tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
              placeholder="Object name"
              aria-label="Object name"
            />
            {/* The description is the popup kit's underline (Samuel, 2026-09-12):
                the same `InlineUnderlineField` the board header wears, imported
                rather than re-cut. Its hint is the word, not a sentence
                (INVARIANTS §5). Saves through `OBJECT_UPDATE` at `subtitle`.

                36px face (Samuel, 2026-09-14): `.inputAction` by import, as
                `board-header-bits.tsx › DescriptionField` has worn since
                2026-09-10, so the two Descriptions cannot drift by a pixel. The
                gray-at-rest → black-on-focus line is unchanged here; the `quiet`
                face belongs to the section rows. */}
            <InlineUnderlineField
              label="Description"
              value={object.subtitle}
              readOnly={!canEdit}
              onChange={(next) =>
                dispatch({ type: "OBJECT_UPDATE", id: objectId, patch: { subtitle: next } })
              }
              className="mt-1 w-full"
              inputClassName={fieldStyles.inputAction}
            />
          </div>

          {isColumn && <TemplateEditor column={object} dispatch={dispatch} canEdit={canEdit} />}
          {isColumn && (
            <p className="text-caption text-text-muted">
              New objects also start with a copy of this object&apos;s relationships and
              actions below.
            </p>
          )}
          <AttributesEditor object={object} graph={graph} dispatch={dispatch} canEdit={canEdit} />
          <RelationshipsEditor
            object={object}
            graph={graph}
            dispatch={dispatch}
            onSelectObject={onSelectObject}
            canEdit={canEdit}
          />
          <ActionsEditor object={object} dispatch={dispatch} canEdit={canEdit} />
          {/* Last, and only once the row exists: while `pending` the id is
              provisional, so the read is skipped rather than 404-ed. */}
          {workspaceId ? (
            <ObjectHistory
              objectId={pending ? null : objectId}
              workspaceId={workspaceId}
              canEdit={canEdit}
            />
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete object?"
        description={deleteObjectMessage(
          object.name || "this object",
          orphanedByObjectDelete(graph, objectId).length
        )}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => {
          onDeleteObject(objectId);
          onClose();
        }}
      />
    </div>
  );
}

/**
 * Confirm copy for an object delete. `count` = objects left unreachable
 * (descendants under no other parent) — without it, a card that silently takes a
 * subtree reads identical to one that takes nothing. Shared with
 * `kanban-column-header.tsx`, which is the same delete.
 */
export function deleteObjectMessage(label: string, count: number): string {
  if (count === 0) {
    return `This permanently deletes "${label}". This can't be undone.`;
  }
  return `This permanently deletes "${label}" and the ${count} object${count === 1 ? "" : "s"} nested under it. This can't be undone.`;
}
