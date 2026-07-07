"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { SectionBox } from "@/shared/ui/section-box";
import type { GraphAction, GraphState } from "../graph-state";
import type { OntologyObject } from "../types";
import { CascadeSelect } from "./cascade-select";
import { CHIP, FIELD_WELL } from "./ontology-bits";

/**
 * Relationships section — editable edges. Each row: edge label, target
 * chips (click = navigate, ✕ = unlink), and the cascade picker to link
 * more (columns or individual objects). Footer adds a new edge.
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

  const addEdge = (targetId: string) => {
    const label = newLabel.trim() || "related to";
    dispatch({ type: "RELATIONSHIP_SET", id: object.id, label, targetIds: [targetId] });
    setNewLabel("");
  };

  return (
    <SectionBox label="Relationships" meta={`${object.relationships.length}`}>
      <div className="divide-y divide-border-subtle">
        {object.relationships.map((rel, i) => (
          <div key={i} className="group flex items-center gap-3 px-4 py-1.5">
            <input
              type="text"
              value={rel.label}
              onChange={(e) =>
                dispatch({
                  type: "RELATIONSHIP_RENAME",
                  id: object.id,
                  index: i,
                  label: e.target.value,
                })
              }
              aria-label="Edge label"
              placeholder="edge label…"
              className="w-32 shrink-0 bg-transparent text-lead italic text-text-secondary placeholder:text-text-muted focus:text-text-primary focus:outline-none"
            />
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {rel.targetIds.map((id) => {
                const target = graph.objects[id];
                if (!target) return null;
                return (
                  <span key={id} className={`flex items-center gap-1.5 ${CHIP}`}>
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
                      className="text-text-muted hover:text-text-primary"
                    >
                      <X size={10} />
                    </button>
                  </span>
                );
              })}
              <CascadeSelect
                graph={graph}
                excludeIds={[object.id, ...rel.targetIds]}
                onPick={(id) =>
                  dispatch({
                    type: "RELATIONSHIP_SET",
                    id: object.id,
                    label: rel.label,
                    targetIds: [...rel.targetIds, id],
                  })
                }
                trigger={
                  <span className="flex items-center gap-1">
                    <Plus size={10} /> Link
                  </span>
                }
                triggerClassName="btn-light flex h-6 items-center rounded-full px-2 text-caption font-medium text-text-primary"
              />
            </span>
            <button
              type="button"
              aria-label={`Remove ${rel.label}`}
              onClick={() => dispatch({ type: "RELATIONSHIP_DELETE", id: object.id, label: rel.label })}
              className="rounded-md p-1 text-text-muted opacity-0 transition hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1.5 border-t border-border-subtle bg-card-surface-subtle px-4 py-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="edge label (e.g. assigned to)…"
            className={`${FIELD_WELL} h-7 w-52 px-2.5 text-body text-text-primary placeholder:text-text-muted`}
          />
          <CascadeSelect
            graph={graph}
            excludeIds={[object.id]}
            onPick={addEdge}
            trigger={
              <span className="flex items-center gap-1">
                <Plus size={11} /> Link target
              </span>
            }
            triggerClassName="btn-light flex h-7 items-center rounded-md px-2.5 text-small font-medium text-text-primary"
          />
        </div>
      </div>
    </SectionBox>
  );
}
