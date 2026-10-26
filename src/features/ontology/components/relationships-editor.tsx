"use client";

import { Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import type { GraphAction, GraphState } from "../graph-state";
import type { ObjectRelationship, OntologyObject } from "../types";
import { ChipStrip, PICK_TRIGGER } from "./attribute-value-editor";
import { InlineUnderlineField } from "@/shared/ui/form-dialog";
import { ObjectPickMenu } from "./object-pick-menu";
import {
  PANEL_GRID,
  PANEL_ROW,
  SECTION_ROWS,
  PanelAddButton,
  PanelSection,
  ROW_REMOVE_BUTTON,
  useDraftRows,
} from "./panel-section";

/** The edge label an unnamed edge is written with. */
const DEFAULT_EDGE_LABEL = "related to";

/**
 * Relationships: one hairline row per edge — label, then target chips (click opens, ✕ unlinks) and
 * the picker. An edge is written the moment it has a target, not a label: `RELATIONSHIP_SET` drops
 * edges with no targets and addresses edges BY LABEL, so a target-less draft has nowhere to land. An
 * empty label is written as "related to"; a label matching an existing edge merges into it.
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
      <div className={SECTION_ROWS}>
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

/** One edge, persisted or draft: one component for both, so a commit keeps the caret. */
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
    <div className={cn(PANEL_ROW, PANEL_GRID)}>
      <InlineUnderlineField
        label="Edge label"
        value={row.label}
        readOnly={!canEdit}
        quiet
        onChange={onRename}
        className="min-w-0"
        inputClassName={fieldStyles.inputSecondary}
      />
      <div className="flex min-w-0 items-center gap-1.5">
        <ChipStrip
          items={row.targetIds.flatMap((id) => {
            const target = graph.objects[id];
            return target ? [{ id, name: target.name }] : [];
          })}
          canEdit={canEdit}
          removeLabel={(item) => `Unlink ${item.name}`}
          onRemove={(id) => onTargets(row.targetIds.filter((t) => t !== id))}
          onOpen={onSelectObject}
          picker={
            <ObjectPickMenu
              graph={graph}
              excludeIds={[object.id, ...row.targetIds]}
              onPick={(id) => onTargets([...row.targetIds, id])}
              trigger={
                <>
                  <Plus size={10} aria-hidden="true" /> Link
                </>
              }
              triggerClassName={PICK_TRIGGER}
            />
          }
        />
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
    </div>
  );
}
