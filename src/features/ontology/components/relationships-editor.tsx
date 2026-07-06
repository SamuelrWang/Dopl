"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import type { GraphAction, GraphState } from "../graph-state";
import type { OntologyObject } from "../types";
import { CHIP, FIELD_WELL, SectionBox, TypeDot } from "./ontology-bits";

/**
 * Relationships section — editable edges. Each row: edge label, target
 * chips (click = navigate, ✕ = unlink), and a picker to link another
 * object. Footer adds a new edge label + first target.
 */
export function RelationshipsEditor({
  object,
  graph,
  dispatch,
  onSelectObject,
}: {
  object: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  onSelectObject: (id: string) => void;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newTarget, setNewTarget] = useState("");

  const candidates = Object.values(graph.objects).filter((o) => o.id !== object.id);

  const addEdge = () => {
    const label = newLabel.trim();
    if (!label || !newTarget) return;
    dispatch({ type: "RELATIONSHIP_SET", id: object.id, label, targetIds: [newTarget] });
    setNewLabel("");
    setNewTarget("");
  };

  return (
    <SectionBox label="Relationships" meta={`${object.relationships.length}`}>
      <div className="divide-y divide-black/[0.05]">
        {object.relationships.map((rel) => (
          <div key={rel.label} className="group flex items-center gap-3 px-4 py-1.5">
            <span className="w-36 shrink-0 text-[13px] italic text-[#646d78]">
              {rel.label}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {rel.targetIds.map((id) => {
                const target = graph.objects[id];
                if (!target) return null;
                return (
                  <span
                    key={id}
                    className={`flex items-center gap-1.5 ${CHIP}`}
                  >
                    <TypeDot type={target.type} />
                    <button
                      type="button"
                      onClick={() => onSelectObject(id)}
                      className="hover:underline"
                    >
                      {target.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Unlink ${target.name}`}
                      onClick={() =>
                        dispatch({
                          type: "RELATIONSHIP_SET",
                          id: object.id,
                          label: rel.label,
                          targetIds: rel.targetIds.filter((t) => t !== id),
                        })
                      }
                      className="text-[#98a2ad] hover:text-[#232a31]"
                    >
                      <X size={10} />
                    </button>
                  </span>
                );
              })}
              <TargetPicker
                candidates={candidates.filter((c) => !rel.targetIds.includes(c.id))}
                onPick={(id) =>
                  dispatch({
                    type: "RELATIONSHIP_SET",
                    id: object.id,
                    label: rel.label,
                    targetIds: [...rel.targetIds, id],
                  })
                }
              />
            </span>
            <button
              type="button"
              aria-label={`Remove ${rel.label}`}
              onClick={() => dispatch({ type: "RELATIONSHIP_DELETE", id: object.id, label: rel.label })}
              className="rounded-md p-1 text-[#98a2ad] opacity-0 transition hover:bg-black/[0.05] hover:text-[#232a31] group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1.5 border-t border-black/[0.06] bg-[#f4f6f9] px-4 py-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="edge label (e.g. assigned to)…"
            className={`${FIELD_WELL} h-7 w-48 px-2.5 text-[12.5px] text-[#232a31] placeholder:text-[#98a2ad]`}
          />
          <select
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            aria-label="Target object"
            className={`${FIELD_WELL} h-7 max-w-44 px-1.5 text-[12px] text-[#646d78]`}
          >
            <option value="">target object…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addEdge}
            className="btn-light flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-[#232a31]"
          >
            <Plus size={11} /> Link
          </button>
        </div>
      </div>
    </SectionBox>
  );
}

function TargetPicker({
  candidates,
  onPick,
}: {
  candidates: OntologyObject[];
  onPick: (id: string) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <select
      value=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
      aria-label="Link another object"
      className="w-6 cursor-pointer appearance-none rounded-full border border-dashed border-black/[0.2] bg-transparent px-1.5 py-0.5 text-center text-xs text-[#98a2ad] hover:border-black/[0.4] hover:text-[#232a31] focus:outline-none"
      title="Link another object"
    >
      <option value="">+</option>
      {candidates.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
