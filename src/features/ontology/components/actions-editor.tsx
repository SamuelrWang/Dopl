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
 * is its own raised card on the inset body; the "pulls" recipe is a
 * chip list with add/remove; footer adds a new action.
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
      method: { name, description: "", outcome: "" },
    });
    setNewName("");
  };

  return (
    <SectionBox label="Actions" meta={`${object.methods.length}`}>
      <p className="px-4 pt-2 text-caption text-text-muted">
        What this object can do — the day-to-day things an agent performs for it.
      </p>
      {object.methods.length > 0 && (
        <div className="flex flex-col gap-2 px-3 pb-3 pt-2">
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
          placeholder="what can it do? (e.g. Send email, Search LinkedIn)…"
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
      <input
        type="text"
        value={method.description}
        onChange={(e) => onChange({ ...method, description: e.target.value })}
        placeholder="How / when the agent should do this…"
        className="mt-0.5 w-full bg-transparent text-lead leading-relaxed text-text-secondary placeholder:text-text-muted focus:outline-none"
        aria-label="Action description"
      />
      <div className="mt-2 text-label font-semibold uppercase tracking-wide text-text-muted">
        Outcome
      </div>
      <input
        type="text"
        value={method.outcome}
        onChange={(e) => onChange({ ...method, outcome: e.target.value })}
        placeholder="What the outcome should be… (e.g. Follow-up email sent and logged)"
        className="mt-1 w-full bg-transparent text-lead leading-relaxed text-text-secondary placeholder:text-text-muted focus:outline-none"
        aria-label="Action outcome"
      />
    </div>
  );
}
