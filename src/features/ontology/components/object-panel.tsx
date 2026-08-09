"use client";

import { useState } from "react";
import { Trash2, X } from "lucide-react";
import type { Dispatch } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { pendingRow } from "@/shared/ui/pending";
import {
  containerNameOf,
  orphanedByObjectDelete,
  type GraphAction,
  type GraphState,
} from "../graph-state";
import { ActionsEditor } from "./actions-editor";
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
   * The object was created optimistically and its POST has not answered, so
   * `objectId` is provisional. The panel opens on it immediately (that is the
   * point — the create is visible at once) but stays inert for the round trip:
   * every control in here writes AT the id, and a PATCH, a DELETE or a
   * relationship target aimed at a provisional id has nowhere to land.
   */
  pending?: boolean;
  /** Member+ — viewers read the panel but see no edit/delete affordances:
   *  inputs go read-only, Delete hides, child editors drop add/remove. */
  canEdit?: boolean;
}

/**
 * Right-side editor panel for the selected object (card or column) —
 * identity header, then attribute / relationship / action editors.
 * Everything edits in place.
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
}: Props) {
  const object = graph.objects[objectId];
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!object) return null;

  const isColumn = graph.clusters.some((c) => c.columnIds.includes(objectId));
  // What the object IS = the name of the column (or object) it lives in.
  const containerName = containerNameOf(graph, objectId);

  return (
    <div
      {...pendingRow(
        pending,
        "my-2 mr-2 flex min-h-0 w-[420px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-border-highlight bg-bg-elevated shadow-[0_2px_6px_rgba(0,0,0,0.07),0_16px_40px_-10px_rgba(0,0,0,0.22)]"
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-card-surface-subtle px-3 py-2">
        {isColumn ? (
          <span className="shrink-0 rounded-full border border-border-strong px-2 py-px text-label font-semibold uppercase tracking-wide text-text-secondary">
            Column · {object.childIds.length}
          </span>
        ) : (
          <span
            className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-2.5 py-0.5 text-caption font-semibold text-text-secondary"
            title="What this object is — its column"
          >
            {containerName ?? "Object"}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-micro text-text-muted">
          {objectId}
        </span>
        {canEdit && (
          <button
            type="button"
            aria-label={`Delete ${object.name}`}
            title="Delete object"
            onClick={() => setConfirmDelete(true)}
            className="btn-light flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-text-primary"
          >
            <Trash2 size={11} />
          </button>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="btn-light flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-text-primary"
        >
          <X size={12} />
        </button>
      </div>

      <div className="min-h-0 grow overflow-y-auto overscroll-contain p-3">
        <div className="flex flex-col gap-3">
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
            <input
              type="text"
              value={object.subtitle}
              readOnly={!canEdit}
              onChange={(e) =>
                dispatch({ type: "OBJECT_UPDATE", id: objectId, patch: { subtitle: e.target.value } })
              }
              placeholder="Short description (agents see this when browsing)…"
              className="mt-0.5 w-full bg-transparent text-lead text-text-secondary placeholder:text-text-muted focus:outline-none"
              aria-label="Object description"
            />
          </div>

          {isColumn && <TemplateEditor column={object} dispatch={dispatch} canEdit={canEdit} />}
          {isColumn && (
            <p className="px-1 text-caption text-text-muted">
              New objects also start with a copy of this column&apos;s relationships and
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
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={isColumn ? "Delete column?" : "Delete object?"}
        description={deleteObjectMessage(
          object.name || (isColumn ? "this column" : "this object"),
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
 * Confirm copy for an object delete. `count` is the number of objects that
 * become unreachable with it — descendants that hang under no other parent.
 * Mirrors `delete-cluster-dialog.tsx`'s shape: without the count, a card that
 * silently takes a subtree with it reads identical to one that takes nothing.
 */
function deleteObjectMessage(label: string, count: number): string {
  if (count === 0) {
    return `This permanently deletes "${label}". This can't be undone.`;
  }
  return `This permanently deletes "${label}" and the ${count} object${count === 1 ? "" : "s"} nested under it. This can't be undone.`;
}
