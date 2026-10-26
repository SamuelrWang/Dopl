"use client";

import { X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import type { GraphAction } from "@/features/ontology/graph-state";
import type { ObjectMethod, OntologyObject } from "@/features/ontology/types";
import { InlineUnderlineField } from "./board-header-bits";
import {
  PANEL_ROW,
  PANEL_ROWS,
  PanelAddButton,
  PanelSection,
  ROW_REMOVE_BUTTON,
  useDraftRows,
} from "./panel-section";

/** A new action's cells, all four empty. */
const BLANK_ACTION: ObjectMethod = { name: "", description: "", outcome: "", tools: "" };

/**
 * Actions: what the object can do, one hairline row per action — its name over description, outcome
 * and tools. An action is written once it has a name (blur or Enter): `METHOD_UPSERT` appends by
 * position, so a nameless one would be a row nobody can address.
 */
export function ActionsEditor({
  object,
  dispatch,
  canEdit = true,
}: {
  object: OntologyObject;
  dispatch: Dispatch<GraphAction>;
  canEdit?: boolean;
}) {
  const { drafts, add, patch, drop } = useDraftRows<ObjectMethod>(() => ({ ...BLANK_ACTION }));

  const commit = (index: number, method: ObjectMethod) => {
    const name = method.name.trim();
    if (!name) return;
    dispatch({ type: "METHOD_UPSERT", id: object.id, index: null, method: { ...method, name } });
    drop(index);
  };

  if (object.methods.length === 0 && !canEdit) {
    return <PanelSection label="Actions">{null}</PanelSection>;
  }

  return (
    <PanelSection label="Actions">
      <div className={PANEL_ROWS}>
        {object.methods.map((m, i) => (
          <ActionRow
            key={`row-${i}`}
            method={m}
            canEdit={canEdit}
            onChange={(method) =>
              dispatch({ type: "METHOD_UPSERT", id: object.id, index: i, method })
            }
            onRemove={() => dispatch({ type: "METHOD_DELETE", id: object.id, index: i })}
          />
        ))}
        {drafts.map((method, n) => (
          <ActionRow
            key={`row-${object.methods.length + n}`}
            method={method}
            canEdit={canEdit}
            onChange={(next) => patch(n, next)}
            onCommit={() => commit(n, method)}
            onRemove={() => drop(n)}
          />
        ))}
        {canEdit && <PanelAddButton onClick={add} />}
      </div>
    </PanelSection>
  );
}

function ActionRow({
  method,
  canEdit,
  onChange,
  onCommit,
  onRemove,
}: {
  method: ObjectMethod;
  canEdit: boolean;
  onChange: (m: ObjectMethod) => void;
  /** Draft only — fires on the name's blur and on Enter. */
  onCommit?: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={cn(PANEL_ROW, "flex flex-col")}>
      {/* "Action …" names, so none collides with the object's own Description. */}
      <div className="flex items-center gap-1.5">
        <InlineUnderlineField
          label="Action name"
          value={method.name}
          readOnly={!canEdit}
          quiet
          onChange={(name) => onChange({ ...method, name })}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit?.();
          }}
          className="min-w-0 flex-1"
          inputClassName="font-medium"
        />
        {canEdit && (
          <button
            type="button"
            aria-label={`Remove ${method.name}`}
            onClick={onRemove}
            className={ROW_REMOVE_BUTTON}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <InlineUnderlineField
        label="Action description"
        value={method.description}
        readOnly={!canEdit}
        quiet
        onChange={(description) => onChange({ ...method, description })}
        inputClassName={fieldStyles.inputSecondary}
      />
      <InlineUnderlineField
        label="Action outcome"
        value={method.outcome}
        readOnly={!canEdit}
        quiet
        onChange={(outcome) => onChange({ ...method, outcome })}
        inputClassName={fieldStyles.inputSecondary}
      />
      <InlineUnderlineField
        label="Action tools"
        value={method.tools ?? ""}
        readOnly={!canEdit}
        quiet
        onChange={(tools) => onChange({ ...method, tools })}
        inputClassName={fieldStyles.inputSecondary}
      />
    </div>
  );
}
