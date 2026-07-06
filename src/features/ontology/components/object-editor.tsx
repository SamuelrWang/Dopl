"use client";

import { Trash2 } from "lucide-react";
import type { Dispatch } from "react";
import { OBJECT_TYPES } from "../seed";
import type { GraphAction, GraphState } from "../graph-state";
import type { ObjectTypeId, OntologyObject } from "../types";
import { ActionsEditor } from "./actions-editor";
import { AttributesEditor } from "./attributes-editor";
import { RelationshipsEditor } from "./relationships-editor";

/**
 * Center panel — the object editor: editable identity header, then
 * attributes / relationships / actions editors in section boxes.
 */
export function ObjectEditor({
  object,
  graph,
  dispatch,
  onSelectObject,
  onDeleteObject,
}: {
  object: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  onSelectObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
}) {
  const typeMeta = OBJECT_TYPES[object.type];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5">
      <div className="flex items-start gap-3 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <input
              type="text"
              value={object.name}
              onChange={(e) =>
                dispatch({ type: "OBJECT_UPDATE", id: object.id, patch: { name: e.target.value } })
              }
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold leading-snug tracking-tight text-[#232a31] placeholder:text-[#98a2ad] focus:outline-none"
              placeholder="Object name"
              aria-label="Object name"
            />
            <select
              value={object.type}
              onChange={(e) =>
                dispatch({
                  type: "OBJECT_UPDATE",
                  id: object.id,
                  patch: { type: e.target.value as ObjectTypeId },
                })
              }
              aria-label="Object type"
              className="shrink-0 cursor-pointer appearance-none rounded-full border px-2.5 py-0.5 text-[11px] font-semibold focus:outline-none"
              style={{
                borderColor: typeMeta.border,
                background: typeMeta.bg,
                color: typeMeta.text,
              }}
            >
              {Object.values(OBJECT_TYPES).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Delete object"
              title="Delete object"
              onClick={() => onDeleteObject(object.id)}
              className="btn-light flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-[#232a31]"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <input
            type="text"
            value={object.subtitle}
            onChange={(e) =>
              dispatch({ type: "OBJECT_UPDATE", id: object.id, patch: { subtitle: e.target.value } })
            }
            placeholder="Short description (agents see this when browsing)…"
            className="mt-0.5 w-full bg-transparent text-[13px] text-[#646d78] placeholder:text-[#98a2ad] focus:outline-none"
            aria-label="Object description"
          />
        </div>
        <span className="pt-1.5 font-mono text-[10px] text-[#98a2ad]">{object.id}</span>
      </div>

      <div className="flex flex-col gap-3.5">
        <AttributesEditor object={object} dispatch={dispatch} />
        <RelationshipsEditor
          object={object}
          graph={graph}
          dispatch={dispatch}
          onSelectObject={onSelectObject}
        />
        <ActionsEditor object={object} dispatch={dispatch} />
      </div>
    </div>
  );
}
