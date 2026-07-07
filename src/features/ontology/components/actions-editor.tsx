"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import type { GraphAction } from "../graph-state";
import type { ObjectMethod, OntologyObject } from "../types";
import { FIELD_WELL, SectionBox } from "./ontology-bits";

/**
 * Actions section — the object's methods. Name/description edit in
 * place; the "pulls" recipe is a chip list with add/remove; footer adds
 * a new action.
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
      method: { name, description: "", requires: [] },
    });
    setNewName("");
  };

  return (
    <SectionBox label="Actions" meta={`${object.methods.length}`}>
      <div className="divide-y divide-border-subtle">
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
        <div className="flex items-center gap-1.5 border-t border-border-subtle bg-card-surface-subtle px-4 py-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAction()}
            placeholder="new action (e.g. Send follow-up email)…"
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
  const [newReq, setNewReq] = useState("");

  const addReq = () => {
    const req = newReq.trim();
    if (!req) return;
    onChange({ ...method, requires: [...method.requires, req] });
    setNewReq("");
  };

  return (
    <div className="group px-4 py-2.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={method.name}
          onChange={(e) => onChange({ ...method, name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-body font-semibold tracking-tight text-text-primary focus:outline-none"
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
        placeholder="What this action does…"
        className="mt-0.5 w-full bg-transparent text-lead leading-relaxed text-text-secondary placeholder:text-text-muted focus:outline-none"
        aria-label="Action description"
      />
      <div className="mt-2 text-label font-semibold uppercase tracking-wide text-text-muted">
        Pulls
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {method.requires.map((r, i) => (
          <span
            key={`${r}-${i}`}
            className="flex items-center gap-1 rounded-md border border-border-default bg-bg-elevated px-2 py-0.5 font-mono text-caption text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
          >
            {r}
            <button
              type="button"
              aria-label={`Remove ${r}`}
              onClick={() =>
                onChange({ ...method, requires: method.requires.filter((_, j) => j !== i) })
              }
              className="text-text-muted hover:text-text-primary"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={newReq}
          onChange={(e) => setNewReq(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addReq()}
          placeholder="+ attribute path (e.g. client.transcripts)"
          className="w-60 rounded-md border border-dashed border-border-highlight bg-transparent px-2 py-0.5 font-mono text-caption text-text-primary placeholder:text-text-muted focus:border-border-highlight focus:outline-none"
        />
      </div>
    </div>
  );
}
