"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { SectionBox } from "@/shared/ui/section-box";
import type { GraphAction } from "../graph-state";
import type { OntologyObject, TemplateField } from "../types";
import { FIELD_WELL } from "./ontology-bits";

const KIND_LABELS: Record<TemplateField["kind"], string> = {
  text: "Text",
  pill: "Tag",
  ref: "Object",
  knowledge: "Knowledge",
  skill: "Skill",
};

/**
 * The column's object template — default fields (label + kind, no
 * values) that every new child object is born with. Deliberately NOT
 * the attributes editor: rows here are field definitions, so there is
 * no value cell to fill, just the label and a kind chip.
 */
export function TemplateEditor({
  column,
  dispatch,
  canEdit = true,
}: {
  column: OntologyObject;
  dispatch: Dispatch<GraphAction>;
  canEdit?: boolean;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newKind, setNewKind] = useState<TemplateField["kind"]>("text");

  const setTemplate = (template: TemplateField[]) =>
    dispatch({ type: "OBJECT_UPDATE", id: column.id, patch: { template } });

  // Upsert by label (case-insensitive), matching the MCP
  // set_template_field semantics — no duplicate default fields.
  const addField = () => {
    const label = newLabel.trim();
    if (!label) return;
    const needle = label.toLowerCase();
    const existing = column.template.find((f) => f.label.toLowerCase() === needle);
    setTemplate(
      existing
        ? column.template.map((f) => (f === existing ? { ...f, label, kind: newKind } : f))
        : [
            ...column.template,
            { key: label.toLowerCase().replace(/\s+/g, "-"), label, kind: newKind },
          ]
    );
    setNewLabel("");
  };

  return (
    <SectionBox label="Default fields" meta={`${column.template.length}`}>
      <p className="px-4 pt-2 pb-1 text-caption text-text-muted">
        New objects in this column start with these fields, ready to fill.
      </p>
      <div className="divide-y divide-border-subtle">
        {column.template.map((field, i) => (
          <div key={`${field.key}-${i}`} className="group flex items-center gap-3 px-4 py-1.5">
            <input
              type="text"
              value={field.label}
              readOnly={!canEdit}
              onChange={(e) =>
                setTemplate(
                  column.template.map((f, j) => (j === i ? { ...f, label: e.target.value } : f))
                )
              }
              aria-label="Field label"
              className="min-w-0 flex-1 bg-transparent text-lead text-text-secondary placeholder:text-text-muted focus:text-text-primary focus:outline-none"
              placeholder="field label…"
            />
            <select
              value={field.kind}
              disabled={!canEdit}
              onChange={(e) =>
                setTemplate(
                  column.template.map((f, j) =>
                    j === i ? { ...f, kind: e.target.value as TemplateField["kind"] } : f
                  )
                )
              }
              aria-label={`Kind of ${field.label}`}
              className={`${FIELD_WELL} h-6 shrink-0 px-1.5 text-small text-text-secondary`}
            >
              {Object.entries(KIND_LABELS).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
            {canEdit && (
              <button
                type="button"
                aria-label={`Remove ${field.label}`}
                onClick={() => setTemplate(column.template.filter((_, j) => j !== i))}
                className="rounded-md p-1 text-text-muted opacity-0 transition hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <div className="flex items-center gap-1.5 border-t border-border-subtle bg-card-surface-subtle px-4 py-2">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addField()}
              placeholder="new default field…"
              className={`${FIELD_WELL} h-7 w-36 px-2.5 text-body text-text-primary placeholder:text-text-muted`}
            />
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as TemplateField["kind"])}
              aria-label="Field kind"
              className={`${FIELD_WELL} h-7 px-1.5 text-small text-text-secondary`}
            >
              {Object.entries(KIND_LABELS).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addField}
              className="btn-light flex h-7 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary"
            >
              <Plus size={11} /> Add
            </button>
          </div>
        )}
      </div>
    </SectionBox>
  );
}
