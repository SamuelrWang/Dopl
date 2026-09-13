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
 * Relationships section — one WHITE BAR per edge on the section's gray well. Row
 * = label, target chips (click = navigate, ✕ = unlink), cascade picker to link
 * more.
 *
 * ⚠ **`+ Add` APPENDS AN EMPTY BAR, IT DOES NOT OPEN A COMPOSER** (Samuel,
 * 2026-09-13: *"Same for actions, relationships, and stuff like that"*). Both
 * cells — the label and the target picker — are on the new bar from the start.
 *
 * ⚠ **AN EDGE IS WRITTEN THE MOMENT IT HAS A TARGET, NOT WHEN IT HAS A LABEL, AND
 * THE REDUCER IS WHY.** `graph-state.ts › RELATIONSHIP_SET` drops any edge whose
 * `targetIds` is empty and addresses edges BY LABEL, so a target-less draft has
 * nowhere to land and two blank ones would be one row. A label left empty is
 * written as "related to" — the same fallback the deleted composer used.
 *
 * ⚠ A draft whose label MATCHES AN EXISTING EDGE merges into it (the reducer's
 * upsert-by-label), so the bar disappears and the target joins the edge above.
 * That is the reducer's rule, stated here because the row makes it visible.
 *
 * ⚠ **FLAT SINCE 2026-09-12** — see `attributes-editor.tsx`'s header for the
 * ruling and what it deleted; the well is not a return of the frame
 * (`panel-section.tsx › PanelSection`).
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

/** ONE EDGE, PERSISTED OR DRAFT — one component for both, so the commit
 *  reconciles in place and keeps the caret (`panel-section.tsx › useDraftRows`). */
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
