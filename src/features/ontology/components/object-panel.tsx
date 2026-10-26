"use client";

import { useState } from "react";
import { Trash2, X } from "lucide-react";
import type { Dispatch } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { pendingRow } from "@/shared/ui/pending";
import {
  containerNameOf,
  orphanedByObjectDelete,
  type GraphAction,
  type GraphState,
} from "../graph-state";
import { InlineUnderlineField } from "@/shared/ui/form-dialog";
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
  /** `objectId` is provisional (create POST unanswered): the panel opens at once but stays inert,
   *  since every write here is aimed at an id the server has not minted. */
  pending?: boolean;
  /** Member+. Viewers get read-only fields, no Delete, and no add/remove in the editors. */
  canEdit?: boolean;
  /** The container the history read is addressed to; History is absent without it. */
  workspaceId?: string;
}

/**
 * The selected object's editor, one white card beside the board: the type as an eyebrow with the
 * quiet delete and close, the name and description edited in place, then the sections.
 */
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

  const isColumn = graph.ontologies.some((c) => c.columnIds.includes(objectId));
  const eyebrow = isColumn
    ? `Object · ${object.childIds.length}`
    : (containerNameOf(graph, objectId) ?? "Object");

  return (
    <div
      {...pendingRow(
        pending,
        "white-card my-2 mr-2 flex min-h-0 w-[420px] shrink-0 flex-col overflow-hidden rounded-[14px]"
      )}
    >
      <header className="flex shrink-0 flex-col border-b border-border-subtle px-4 pt-2 pb-3">
        <div className="-mr-2 flex items-center">
          <span className="min-w-0 flex-1 truncate text-caption font-medium text-text-muted">
            {eyebrow}
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
          <button type="button" aria-label="Close" onClick={onClose} className={NAKED_ICON_BUTTON}>
            <X size={NAKED_ICON} />
          </button>
        </div>
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
        <InlineUnderlineField
          label="Description"
          value={object.subtitle}
          readOnly={!canEdit}
          quiet
          onChange={(next) =>
            dispatch({ type: "OBJECT_UPDATE", id: objectId, patch: { subtitle: next } })
          }
          className="w-full"
          inputClassName={fieldStyles.inputSecondary}
        />
      </header>

      <div className="min-h-0 grow overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
        <div className="flex flex-col gap-5">
          {isColumn && <TemplateEditor column={object} dispatch={dispatch} canEdit={canEdit} />}
          {isColumn && (
            <p className="-mt-3 text-caption text-text-muted">
              New objects also start with a copy of this object&apos;s relationships and actions
              below.
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
 * Confirm copy for an object delete. `count` = objects left unreachable (descendants under no
 * other parent), so a card that takes a subtree never reads like one that takes nothing.
 */
export function deleteObjectMessage(label: string, count: number): string {
  if (count === 0) {
    return `This permanently deletes "${label}". This can't be undone.`;
  }
  return `This permanently deletes "${label}" and the ${count} object${count === 1 ? "" : "s"} nested under it. This can't be undone.`;
}
