"use client";

import { useState } from "react";
import { Trash2, X } from "lucide-react";
import type { Dispatch } from "react";
import { OBJECT_TYPES } from "../constants";
import type { GraphAction, GraphState } from "../graph-state";
import type { ObjectTypeId } from "../types";
import { ActionsEditor } from "./actions-editor";
import { AttributesEditor } from "./attributes-editor";
import { RelationshipsEditor } from "./relationships-editor";

interface Props {
  objectId: string;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  onSelectObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
  onClose: () => void;
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
}: Props) {
  const object = graph.objects[objectId];
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!object) return null;

  const typeMeta = OBJECT_TYPES[object.type];
  const isColumn = graph.clusters.some((c) => c.columnIds.includes(objectId));

  return (
    <div className="my-2 mr-2 flex min-h-0 w-[420px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-black/[0.14] bg-[#fbfcfd] shadow-[0_2px_6px_rgba(0,0,0,0.07),0_16px_40px_-10px_rgba(0,0,0,0.22)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] bg-[#f4f6f9] px-3 py-2">
        <select
          value={object.type}
          onChange={(e) =>
            dispatch({
              type: "OBJECT_UPDATE",
              id: objectId,
              patch: { type: e.target.value as ObjectTypeId },
            })
          }
          aria-label="Object type"
          className="shrink-0 cursor-pointer appearance-none rounded-full border px-2.5 py-0.5 text-[11px] font-semibold focus:outline-none"
          style={{ borderColor: typeMeta.border, background: typeMeta.bg, color: typeMeta.text }}
        >
          {Object.values(OBJECT_TYPES).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {isColumn && (
          <span className="shrink-0 rounded-full border border-black/[0.12] px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-[#646d78]">
            Column · {object.childIds.length}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#98a2ad]">
          {objectId}
        </span>
        {confirmDelete ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onDeleteObject(objectId);
                onClose();
              }}
              className="rounded-md bg-[#fdecec] px-2 py-1 text-[11px] font-semibold text-[#c04543]"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="btn-light rounded-md px-2 py-1 text-[11px] font-medium text-[#232a31]"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Delete ${object.name}`}
            title="Delete object"
            onClick={() => setConfirmDelete(true)}
            className="btn-light flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-[#232a31]"
          >
            <Trash2 size={11} />
          </button>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="btn-light flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-[#232a31]"
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
              onChange={(e) =>
                dispatch({ type: "OBJECT_UPDATE", id: objectId, patch: { name: e.target.value } })
              }
              className="w-full bg-transparent text-lg font-semibold leading-snug tracking-tight text-[#232a31] placeholder:text-[#98a2ad] focus:outline-none"
              placeholder="Object name"
              aria-label="Object name"
            />
            <input
              type="text"
              value={object.subtitle}
              onChange={(e) =>
                dispatch({ type: "OBJECT_UPDATE", id: objectId, patch: { subtitle: e.target.value } })
              }
              placeholder="Short description (agents see this when browsing)…"
              className="mt-0.5 w-full bg-transparent text-[13px] text-[#646d78] placeholder:text-[#98a2ad] focus:outline-none"
              aria-label="Object description"
            />
          </div>

          <AttributesEditor object={object} graph={graph} dispatch={dispatch} />
          <RelationshipsEditor
            object={object}
            graph={graph}
            dispatch={dispatch}
            onSelectObject={onSelectObject}
          />
          <ActionsEditor object={object} dispatch={dispatch} />
        </div>
      </div>
    </div>
  );
}
