"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { SectionBox } from "@/shared/ui/section-box";
import type { GraphAction } from "../graph-state";
import type { ObjectMethod, OntologyObject } from "../types";
import { FIELD_WELL } from "./ontology-bits";

/**
 * Actions section — what the object CAN DO: the day-to-day things an
 * agent performs for it (send email, search LinkedIn, …). Each action
 * is its own raised card on the inset body: name on the card, then
 * concave entry wells for description / outcome / tools. Footer adds a
 * new action.
 */
export function ActionsEditor({
  object,
  dispatch,
}: {
  object: OntologyObject;
  dispatch: Dispatch<GraphAction>;
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
    <SectionBox label="Actions" meta={`${object.methods.length}`}>
      {object.methods.length > 0 && (
        <div className="flex flex-col gap-2 px-3 py-3">
          {object.methods.map((m, i) => (
            <ActionRow
              key={`${m.name}-${i}`}
              method={m}
              onChange={(method) =>
                dispatch({ type: "METHOD_UPSERT", id: object.id, index: i, method })
              }
              onDelete={() => dispatch({ type: "METHOD_DELETE", id: object.id, index: i })}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 border-t border-border-subtle bg-card-surface-subtle px-4 py-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAction()}
          placeholder="action name (e.g. Send email)…"
          className={`${FIELD_WELL} h-7 w-64 px-2.5 text-body text-text-primary placeholder:text-text-muted`}
        />
        <button
          type="button"
          onClick={addAction}
          className="btn-light flex h-7 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary"
        >
          <Plus size={11} /> Add
        </button>
      </div>
    </SectionBox>
  );
}

function ActionRow({
  method,
  onChange,
  onDelete,
}: {
  method: ObjectMethod;
  onChange: (m: ObjectMethod) => void;
  onDelete: () => void;
}) {
  return (
    <div className="bento group px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={method.name}
          onChange={(e) => onChange({ ...method, name: e.target.value })}
          placeholder="e.g. Send email…"
          className="min-w-0 flex-1 bg-transparent text-body font-semibold tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
          aria-label="Action name"
        />
        <button
          type="button"
          aria-label={`Remove ${method.name}`}
          onClick={onDelete}
          className="rounded-md p-1 text-text-muted opacity-0 transition hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100"
        >
          <X size={12} />
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <input
          type="text"
          value={method.description}
          onChange={(e) => onChange({ ...method, description: e.target.value })}
          placeholder="Description"
          className={`${FIELD_WELL} h-7 w-full px-2.5 text-body text-text-primary placeholder:text-text-muted`}
          aria-label="Action description"
        />
        <input
          type="text"
          value={method.outcome}
          onChange={(e) => onChange({ ...method, outcome: e.target.value })}
          placeholder="Outcome"
          className={`${FIELD_WELL} h-7 w-full px-2.5 text-body text-text-primary placeholder:text-text-muted`}
          aria-label="Action outcome"
        />
        <input
          type="text"
          value={method.tools ?? ""}
          onChange={(e) => onChange({ ...method, tools: e.target.value })}
          placeholder="Tools"
          className={`${FIELD_WELL} h-7 w-full px-2.5 text-body text-text-primary placeholder:text-text-muted`}
          aria-label="Action tools"
        />
      </div>
    </div>
  );
}
