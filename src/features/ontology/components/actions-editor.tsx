"use client";

import { X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import type { GraphAction } from "../graph-state";
import type { ObjectMethod, OntologyObject } from "../types";
import { InlineUnderlineField } from "./board-header-bits";
import {
  PANEL_ROW,
  PANEL_WELL,
  PanelAddButton,
  PanelSection,
  ROW_REMOVE_BUTTON,
  useDraftRows,
} from "./panel-section";

/** A new action's cells, all four empty. */
const BLANK_ACTION: ObjectMethod = { name: "", description: "", outcome: "", tools: "" };

/**
 * Actions section — what the object CAN DO (things an agent performs for it).
 * One WHITE BAR per action on the section's gray well, holding the action's NAME
 * with its description / outcome / tools under it.
 *
 * ⚠ **`+ Add` APPENDS AN EMPTY BAR WITH ALL FOUR FIELDS ON IT** (Samuel,
 * 2026-09-13: *"Same for actions, relationships, and stuff like that"*). The add
 * composer — a lone name field and an Add button — is deleted: an action's
 * outcome and tools are typeable before its name is written.
 *
 * ⚠ **THE ROW IS WRITTEN WHEN IT HAS A NAME** (its label's blur, or Enter), for
 * the reason in `panel-section.tsx › useDraftRows`: `METHOD_UPSERT` appends by
 * position, so a nameless action would be a row nobody can read or address.
 *
 * ⚠ **FLAT SINCE 2026-09-12** (Samuel: *"no more indented stuff"*) — the fields
 * are the popup kit's underline, never a `FIELD_WELL`, and what the bar restores
 * is a SURFACE under the four lines, not the three nested frames that ruling cut
 * (`panel-section.tsx › PanelSection`).
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
      <div className={PANEL_WELL}>
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
  /** DRAFT ONLY — fires on the name's blur and on Enter. */
  onCommit?: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={cn(PANEL_ROW, "group flex flex-col gap-1.5")}>
      {/* ⚠ THE THREE UNDER-FIELDS KEEP THEIR OLD ACCESSIBLE NAMES ("Action
          description" / "Action outcome" / "Action tools") AND NOW SHOW THEM AS
          THE HINT: the field's name IS its hint in this face, and a bare
          "Description" here would collide with the OBJECT's own Description two
          sections up — one accessible name, two different things. */}
      <div className="flex items-center gap-2">
        <InlineUnderlineField
          label="Action name"
          value={method.name}
          readOnly={!canEdit}
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
        onChange={(description) => onChange({ ...method, description })}
      />
      <InlineUnderlineField
        label="Action outcome"
        value={method.outcome}
        readOnly={!canEdit}
        onChange={(outcome) => onChange({ ...method, outcome })}
      />
      <InlineUnderlineField
        label="Action tools"
        value={method.tools ?? ""}
        readOnly={!canEdit}
        onChange={(tools) => onChange({ ...method, tools })}
      />
    </div>
  );
}
