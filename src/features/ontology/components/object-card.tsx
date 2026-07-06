"use client";

import { useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { OBJECT_TYPES } from "../seed";
import type { GraphAction, GraphState } from "../graph-state";
import type { ObjectTypeId } from "../types";
import { ActionsEditor } from "./actions-editor";
import { AttributesEditor } from "./attributes-editor";
import { RelationshipsEditor } from "./relationships-editor";

const MAX_NEST_DEPTH = 4;

interface Props {
  objectId: string;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  depth: number;
  onSelectObject: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onDeleteObject: (id: string) => void;
}

/**
 * A nested object as a self-contained box: header (name / type /
 * delete), and when open, its attribute / relationship / action editors
 * plus its own nested objects — recursively, each a smaller card.
 */
export function ObjectCard({
  objectId,
  graph,
  dispatch,
  depth,
  onSelectObject,
  onCreateChild,
  onDeleteObject,
}: Props) {
  const object = graph.objects[objectId];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [open, setOpen] = useState(false);
  if (!object) return null;

  const typeMeta = OBJECT_TYPES[object.type];

  return (
    <div
      id={`obj-card-${objectId}`}
      className={cn(
        "overflow-hidden rounded-[14px] border border-black/[0.12] bg-[#fbfcfd]",
        depth === 0 && "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_18px_rgba(0,0,0,0.05)]"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2",
          open && "border-b border-black/[0.06]"
        )}
      >
        <button
          type="button"
          aria-label={open ? "Collapse" : "Expand"}
          onClick={() => setOpen((o) => !o)}
          className="rounded-md p-1 text-[#98a2ad] transition hover:bg-black/[0.05] hover:text-[#232a31]"
        >
          <ChevronRight
            size={14}
            className={cn("transition-transform", open && "rotate-90")}
          />
        </button>
        <input
          type="text"
          value={object.name}
          onChange={(e) =>
            dispatch({ type: "OBJECT_UPDATE", id: objectId, patch: { name: e.target.value } })
          }
          className={cn(
            "min-w-0 flex-1 bg-transparent font-semibold tracking-tight text-[#232a31] placeholder:text-[#98a2ad] focus:outline-none",
            depth === 0 ? "text-[15px]" : "text-[13.5px]"
          )}
          placeholder="Object name"
          aria-label="Object name"
        />
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
        <span className="hidden shrink-0 font-mono text-[10px] text-[#98a2ad] md:inline">
          {objectId}
        </span>
        {confirmDelete ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onDeleteObject(objectId)}
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
            className="btn-light flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-[#232a31]"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-3 p-3">
          <input
            type="text"
            value={object.subtitle}
            onChange={(e) =>
              dispatch({ type: "OBJECT_UPDATE", id: objectId, patch: { subtitle: e.target.value } })
            }
            placeholder="Short description (agents see this when browsing)…"
            className="w-full bg-transparent px-1 text-[13px] text-[#646d78] placeholder:text-[#98a2ad] focus:outline-none"
            aria-label="Object description"
          />
          <AttributesEditor object={object} dispatch={dispatch} />
          <RelationshipsEditor
            object={object}
            graph={graph}
            dispatch={dispatch}
            onSelectObject={onSelectObject}
          />
          <ActionsEditor object={object} dispatch={dispatch} />

          <section className="w-full overflow-hidden rounded-[14px] border border-black/[0.12]">
            <div className="flex items-center gap-2 bg-[#f4f6f9] px-4 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#646d78]">
                Objects inside
              </span>
              <span className="text-[11px] text-[#98a2ad]">{object.childIds.length}</span>
              <span className="flex-1" />
              {depth < MAX_NEST_DEPTH && (
                <button
                  type="button"
                  onClick={() => onCreateChild(objectId)}
                  className="btn-light flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-[#232a31]"
                >
                  <Plus size={11} /> Object
                </button>
              )}
            </div>
            {object.childIds.length > 0 ? (
              <div className="flex flex-col gap-2.5 border-t border-black/[0.06] bg-[#eef1f5] p-2.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),inset_0_1px_2px_rgba(0,0,0,0.06),inset_0_-1px_0_rgba(255,255,255,0.9)]">
                {object.childIds.map((childId) => (
                  <ObjectCard
                    key={childId}
                    objectId={childId}
                    graph={graph}
                    dispatch={dispatch}
                    depth={depth + 1}
                    onSelectObject={onSelectObject}
                    onCreateChild={onCreateChild}
                    onDeleteObject={onDeleteObject}
                  />
                ))}
              </div>
            ) : (
              <p className="border-t border-black/[0.06] bg-[#eef1f5] px-4 py-2.5 text-xs text-[#98a2ad] shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),inset_0_1px_2px_rgba(0,0,0,0.06),inset_0_-1px_0_rgba(255,255,255,0.9)]">
                No nested objects — e.g. a client&apos;s correspondents each live
                here as their own object.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
