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
   * `objectId` is provisional (create POST unanswered). Panel opens on it at
   * once but stays inert for the round trip — ⚠ every control here writes AT
   * the id, and a PATCH/DELETE/relationship target aimed at a provisional id
   * has nowhere to land.
   */
  pending?: boolean;
  /** Member+ — viewers see no edit/delete affordances: inputs read-only,
   *  Delete hidden, child editors drop add/remove. */
  canEdit?: boolean;
  /** The container the HISTORY read is addressed to (`X-Workspace-Id`).
   *  ⚠ Optional: the History section is simply absent without it, rather than
   *  the panel guessing a container for a read that follows an id. */
  workspaceId?: string;
}

/**
 * NAKED ICONS — **THE TWO HEADER CONTROLS HAVE NO BUTTON FACE AT ALL** (Samuel,
 * 2026-09-12: *"also for the trash and X buttons, just have it be naked icons,
 * no more button UI if that makes sense"*). They wore `btn-light`: a raised
 * 24×28 pill each, two of them beside a uuid, which read as the panel's most
 * important row.
 *
 * ⚠ **THE 30px BOX IS PADDING, NOT A HEIGHT** — `p-2` around the board header's
 * own 14px glyph — so the hit area is the small-action scale while the only ink
 * on screen is the glyph. Muted at rest, primary on hover; no border, no fill,
 * no shadow, in any state.
 */
const NAKED_ICON_BUTTON =
  "flex shrink-0 items-center justify-center rounded-[8px] p-2 " +
  "text-text-muted transition-colors hover:text-text-primary";

/** The glyph inside it — the size the board header's gear wears. */
const NAKED_ICON = 14;

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
      {/* ⚠ **THE TOP LINE IS A NAME, NOT A PILL, AND THE UUID IS GONE** (Samuel,
          2026-09-12: *"at the top, it shouldnt be a pill, just have it be the name
          of the object … no need to show the ID in the UI"*). It wears the recipe
          the board header's name trigger wears — `text-body font-medium
          text-text-primary` — so the two faces read as one vocabulary. For a CARD
          it is the object TYPE the card is one of (its lane's name); for the LANE
          itself there is no parent to name, so the line states what the panel is
          and how many items the type has. ⚠ The id was a `font-mono` column
          between the pill and the buttons: nobody reads a uuid, and it is not in
          a `title` either — a tooltip is still UI. */}
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
            {/* ⚠ **THE DESCRIPTION IS THE POPUP KIT'S UNDERLINE** (Samuel,
                2026-09-12: *"For the description, that UI should be the
                underline"*) — the SAME `InlineUnderlineField` the board header's
                Description wears, imported rather than re-cut, so the 2px
                gray→black sweep is one recipe on both rows. ⚠ Its hint is the
                WORD, not a sentence: the placeholder was a parenthetical about
                what agents see, which is a paragraph in a field (INVARIANTS §5).
                ⚠ SAME SAVE PATH — `OBJECT_UPDATE` at `subtitle`, debounced by
                the store. */}
            <InlineUnderlineField
              label="Description"
              value={object.subtitle}
              readOnly={!canEdit}
              onChange={(next) =>
                dispatch({ type: "OBJECT_UPDATE", id: objectId, patch: { subtitle: next } })
              }
              className="mt-1 w-full"
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
          {/* ⚠ LAST, AND ONLY ONCE THE ROW EXISTS. `pending` means the create
              POST is unanswered and the id is provisional, so the read is not
              made rather than made and 404-ed. */}
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
 * (descendants under no other parent) — without it, a card that silently takes
 * a subtree reads identical to one that takes nothing.
 *
 * ⚠ Exported and shared with `kanban-column-header.tsx` (same delete, lane
 * kebab menu) — two spellings would drift.
 */
export function deleteObjectMessage(label: string, count: number): string {
  if (count === 0) {
    return `This permanently deletes "${label}". This can't be undone.`;
  }
  return `This permanently deletes "${label}" and the ${count} object${count === 1 ? "" : "s"} nested under it. This can't be undone.`;
}
