"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import type { GraphAction, GraphState } from "../graph-state";
import type { OntologyObject } from "../types";
import { InlineUnderlineField } from "./board-header-bits";
import { ObjectPickMenu } from "./object-pick-menu";
import { CHIP } from "./ontology-bits";
import { PANEL_ADD_ROW, PanelSection, ROW_REMOVE_BUTTON } from "./panel-section";

/**
 * Relationships section — editable edges. Row = label, target chips (click =
 * navigate, ✕ = unlink), cascade picker to link more. The last row adds an edge.
 *
 * ⚠ **FLAT SINCE 2026-09-12** — see `attributes-editor.tsx`'s header for the
 * ruling and what it deleted; this section is the same shape, one row per edge.
 */
export function RelationshipsEditor({
  object,
  graph,
  dispatch,
  onSelectObject,
  canEdit = true,
}: {
  object: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  onSelectObject: (id: string) => void;
  canEdit?: boolean;
}) {
  const [newLabel, setNewLabel] = useState("");

  const addEdge = (targetId: string) => {
    const label = newLabel.trim() || "related to";
    dispatch({ type: "RELATIONSHIP_SET", id: object.id, label, targetIds: [targetId] });
    setNewLabel("");
  };

  return (
    <PanelSection label="Relationships" meta={`${object.relationships.length}`}>
      {object.relationships.map((rel, i) => (
        <div key={i} className="group flex items-center gap-3">
          <InlineUnderlineField
            label="Edge label"
            value={rel.label}
            readOnly={!canEdit}
            onChange={(label) =>
              dispatch({ type: "RELATIONSHIP_RENAME", id: object.id, index: i, label })
            }
            className="w-32 shrink-0"
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
                  {canEdit && (
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
                  )}
                </span>
              );
            })}
            {canEdit && (
              <ObjectPickMenu
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
                  <>
                    <Plus size={10} /> Link
                  </>
                }
                triggerClassName={cn(SMALL_TEXT_BUTTON, "gap-1")}
              />
            )}
          </span>
          {canEdit && (
            <button
              type="button"
              aria-label={`Remove ${rel.label}`}
              onClick={() => dispatch({ type: "RELATIONSHIP_DELETE", id: object.id, label: rel.label })}
              className={ROW_REMOVE_BUTTON}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <div className={PANEL_ADD_ROW}>
          <InlineUnderlineField
            label="New edge label"
            value={newLabel}
            onChange={setNewLabel}
            className="w-44"
          />
          <ObjectPickMenu
            graph={graph}
            excludeIds={[object.id]}
            onPick={addEdge}
            trigger={
              <>
                <Plus size={11} /> Link target
              </>
            }
            triggerClassName={cn(SMALL_TEXT_BUTTON, "gap-1")}
          />
        </div>
      )}
    </PanelSection>
  );
}
