"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import type { GraphAction } from "../graph-state";
import type { ObjectMethod, OntologyObject } from "../types";
import { InlineUnderlineField } from "./board-header-bits";
import { PANEL_ADD_ROW, PanelSection, ROW_REMOVE_BUTTON } from "./panel-section";

/**
 * Actions section — what the object CAN DO (things an agent performs for it).
 * Each action is a NAME row with its description / outcome / tools under it.
 *
 * ⚠ **FLAT SINCE 2026-09-12** (Samuel: *"no more indented stuff"*). Each action
 * was a raised `bento` card holding three concave `FIELD_WELL` inputs, inside the
 * section frame — three indents deep. It is four underline fields in one column
 * now, and the only thing separating one action from the next is the gap.
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
  const [newName, setNewName] = useState("");

  const addAction = () => {
    const name = newName.trim();
    if (!name) return;
    dispatch({
      type: "METHOD_UPSERT",
      id: object.id,
      index: null,
      method: { name, description: "", outcome: "", tools: "" },
    });
    setNewName("");
  };

  return (
    <PanelSection label="Actions" meta={`${object.methods.length}`}>
      {object.methods.map((m, i) => (
        <ActionRow
          key={`${m.name}-${i}`}
          method={m}
          canEdit={canEdit}
          onChange={(method) => dispatch({ type: "METHOD_UPSERT", id: object.id, index: i, method })}
          onDelete={() => dispatch({ type: "METHOD_DELETE", id: object.id, index: i })}
        />
      ))}
      {canEdit && (
        <div className={PANEL_ADD_ROW}>
          <InlineUnderlineField
            label="New action"
            value={newName}
            onChange={setNewName}
            onKeyDown={(e) => {
              if (e.key === "Enter") addAction();
            }}
            className="w-56"
          />
          <button type="button" onClick={addAction} className={cn(SMALL_TEXT_BUTTON, "gap-1")}>
            <Plus size={11} /> Add
          </button>
        </div>
      )}
    </PanelSection>
  );
}

function ActionRow({
  method,
  canEdit,
  onChange,
  onDelete,
}: {
  method: ObjectMethod;
  canEdit: boolean;
  onChange: (m: ObjectMethod) => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex flex-col gap-1.5">
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
          className="min-w-0 flex-1"
          inputClassName="font-medium"
        />
        {canEdit && (
          <button
            type="button"
            aria-label={`Remove ${method.name}`}
            onClick={onDelete}
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
