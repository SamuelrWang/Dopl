"use client";

import { Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import type { GraphAction, GraphState } from "../graph-state";
import type { ObjectRelationship, OntologyObject } from "../types";
import { InlineUnderlineField } from "./board-header-bits";
import { ObjectPickMenu } from "./object-pick-menu";
import { CHIP } from "./ontology-bits";
import {
  PANEL_ROW,
  PANEL_ROWS,
  PanelAddButton,
  PanelSection,
  ROW_REMOVE_BUTTON,
  useDraftRows,
} from "./panel-section";

/** The edge label an unnamed edge is written with — the composer's old default. */
const DEFAULT_EDGE_LABEL = "related to";

/**
 * Relationships section — one white bar per edge on the section's gray well: label,
 * target chips (click = navigate, ✕ = unlink), cascade picker to link more.
 * `+ Add` appends an empty bar rather than opening a composer (Samuel, 2026-09-13).
 *
 * An edge is written the moment it has a target, not when it has a label:
 * `graph-state.ts › RELATIONSHIP_SET` drops edges with empty `targetIds` and
 * addresses edges BY LABEL, so a target-less draft has nowhere to land and two
 * blank ones would collapse into one row. An empty label is written as
 * "related to"; a label matching an existing edge merges into it (upsert-by-label),
 * so the bar disappears and the target joins the edge above.
 *
 * Flat since 2026-09-12 — see `attributes-editor.tsx`'s header; the well is not a
 * return of the frame (`panel-section.tsx › PanelSection`).
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
  const { drafts, add, patch, drop } = useDraftRows<ObjectRelationship>(() => ({
    label: "",
    targetIds: [],
  }));

  if (object.relationships.length === 0 && !canEdit) {
    return <PanelSection label="Relationships">{null}</PanelSection>;
  }

  return (
    <PanelSection label="Relationships">
      <div className={PANEL_ROWS}>
        {object.relationships.map((rel, i) => (
          <RelRow
            key={`row-${i}`}
            row={rel}
            object={object}
            graph={graph}
            canEdit={canEdit}
            onSelectObject={onSelectObject}
            onRename={(label) =>
              dispatch({ type: "RELATIONSHIP_RENAME", id: object.id, index: i, label })
            }
            onTargets={(targetIds) =>
              dispatch({ type: "RELATIONSHIP_SET", id: object.id, label: rel.label, targetIds })
            }
            onRemove={() =>
              dispatch({ type: "RELATIONSHIP_DELETE", id: object.id, label: rel.label })
            }
          />
        ))}
        {drafts.map((row, n) => (
          <RelRow
            key={`row-${object.relationships.length + n}`}
            row={row}
            object={object}
            graph={graph}
            canEdit={canEdit}
            onSelectObject={onSelectObject}
            onRename={(label) => patch(n, { ...row, label })}
            onTargets={(targetIds) => {
              dispatch({
                type: "RELATIONSHIP_SET",
                id: object.id,
                label: row.label.trim() || DEFAULT_EDGE_LABEL,
                targetIds,
              });
              drop(n);
            }}
            onRemove={() => drop(n)}
          />
        ))}
        {canEdit && <PanelAddButton onClick={add} />}
      </div>
    </PanelSection>
  );
}

/**
 * One edge, persisted or draft — one component for both, so a commit reconciles in
 * place and keeps the caret (`panel-section.tsx › useDraftRows`).
 *
 * Row fields are `quiet` since 2026-09-14 (Samuel): no gray rule at rest, black
 * line on focus only. A resting state of the one underline recipe
 * (`board-header-bits.tsx › InlineUnderlineField`), not a second face; the panel's
 * Description keeps its gray-at-rest line.
 *
 * The 2026-09-14 reorder is the ATTRIBUTE row's: this row is already label →
 * targets with no kind picker between them, and no colon — the edge's label is the
 * sentence, not a field name in front of a value.
 */
function RelRow({
  row,
  object,
  graph,
  canEdit,
  onSelectObject,
  onRename,
  onTargets,
  onRemove,
}: {
  row: ObjectRelationship;
  object: OntologyObject;
  graph: GraphState;
  canEdit: boolean;
  onSelectObject: (id: string) => void;
  onRename: (label: string) => void;
  onTargets: (targetIds: string[]) => void;
  onRemove: () => void;
}) {
  return (
    <div className={cn(PANEL_ROW, "group flex flex-wrap items-center gap-2")}>
      <InlineUnderlineField
        label="Edge label"
        value={row.label}
        readOnly={!canEdit}
        quiet
        onChange={onRename}
        className="w-28 shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {row.targetIds.map((id) => {
          const target = graph.objects[id];
          if (!target) return null;
          return (
            <span key={id} className={`flex items-center gap-1.5 ${CHIP}`}>
              <button type="button" onClick={() => onSelectObject(id)} className="hover:underline">
                {target.name}
              </button>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Unlink ${target.name}`}
                  onClick={() => onTargets(row.targetIds.filter((t) => t !== id))}
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
            excludeIds={[object.id, ...row.targetIds]}
            onPick={(id) => onTargets([...row.targetIds, id])}
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
          aria-label={`Remove ${row.label}`}
          onClick={onRemove}
          className={ROW_REMOVE_BUTTON}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
