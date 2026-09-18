"use client";

import { X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import type { GraphAction } from "../graph-state";
import type { ObjectMethod, OntologyObject } from "../types";
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
 * Actions section — what the object can do. One white bar per action holding its
 * name with description / outcome / tools under it.
 *
 * 2026-09-13: `+ Add` appends an empty bar with all four fields on it, so an
 * action's outcome and tools are typeable before its name is written.
 *
 * The row is written when it has a name (label blur, or Enter), for the reason in
 * `panel-section.tsx › useDraftRows`: `METHOD_UPSERT` appends by position, so a
 * nameless action would be a row nobody can read or address.
 *
 * Flat since 2026-09-12 — the fields are the popup kit's underline, never a
 * `FIELD_WELL`, and the bar restores a surface under the four lines, not the
 * nested frames that ruling cut (`panel-section.tsx › PanelSection`).
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

/**
 * Fields are `quiet` since 2026-09-14: the kit's `.inputQuiet`, a resting state of
 * the one underline recipe (`board-header-bits.tsx › InlineUnderlineField`), not
 * a second face. The panel's own description keeps its gray-at-rest line; the rule
 * is about row cells.
 *
 * Order untouched: the `Attribute : value dropdown` reordering is the attribute
 * row's shape, and an action is a stack of four named fields with no value cell.
 */
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
    <div className={cn(PANEL_ROW, "group flex flex-col gap-1.5")}>
      {/* The three under-fields keep their "Action …" accessible names and show
          them as the hint: a bare "Description" here would collide with the
          object's own Description two sections up. */}
      <div className="flex items-center gap-2">
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
      />
      <InlineUnderlineField
        label="Action outcome"
        value={method.outcome}
        readOnly={!canEdit}
        quiet
        onChange={(outcome) => onChange({ ...method, outcome })}
      />
      <InlineUnderlineField
        label="Action tools"
        value={method.tools ?? ""}
        readOnly={!canEdit}
        quiet
        onChange={(tools) => onChange({ ...method, tools })}
      />
    </div>
  );
}
