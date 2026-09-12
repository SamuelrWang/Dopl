"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import type { GraphAction } from "../graph-state";
import type { OntologyObject, TemplateField } from "../types";
import { InlineUnderlineField } from "./board-header-bits";
import { PANEL_ADD_ROW, PanelSection, ROW_REMOVE_BUTTON } from "./panel-section";

/** ⚠ Shared with the column header card's read-only template preview — two
 *  renderings of a field's kind must not drift. */
export const KIND_LABELS: Record<TemplateField["kind"], string> = {
  text: "Text",
  pill: "Tag",
  ref: "Object",
  knowledge: "Knowledge",
  skill: "Skill",
};

/** THE SAME SET AS `SelectMenu` OPTIONS — one declaration, so the template's
 *  kind picker and the attributes' cannot offer different words for one kind.
 *  ⚠ No `description`: five one-word kinds, and a second line per option in a
 *  420px panel is the paragraph the minimal-copy ruling refuses. */
export const KIND_OPTIONS: ReadonlyArray<SelectMenuOption<TemplateField["kind"]>> =
  Object.entries(KIND_LABELS).map(([value, label]) => ({
    value: value as TemplateField["kind"],
    label,
  }));

/**
 * The column's object template — default fields (label + kind, no values) every
 * new child is born with. NOT the attributes editor: rows are field
 * definitions, so there is no value cell, just label + kind.
 *
 * ⚠ **FLAT SINCE 2026-09-12** (Samuel, over the object panel: *"no more indented
 * stuff"*) — `PanelSection` instead of `SectionBox`, its rows at the panel's own
 * padding, the kind picker a `SelectMenu` text face instead of a native
 * `<select>` in an inset well, and no divider grid: one column of rows.
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

  // ⚠ Upsert by label (case-insensitive) to match MCP `set_template_field`
  // semantics — no duplicate default fields.
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
    <PanelSection label="Default fields" meta={`${column.template.length}`}>
      <p className="text-caption text-text-muted">
        New objects of this type start with these fields, ready to fill.
      </p>
      {column.template.map((field, i) => (
        <div key={`${field.key}-${i}`} className="group flex items-center gap-3">
          <InlineUnderlineField
            label="Field label"
            value={field.label}
            readOnly={!canEdit}
            onChange={(next) =>
              setTemplate(column.template.map((f, j) => (j === i ? { ...f, label: next } : f)))
            }
            className="min-w-0 flex-1"
          />
          <SelectMenu
            value={field.kind}
            options={KIND_OPTIONS}
            disabled={!canEdit}
            onChange={(kind) =>
              setTemplate(column.template.map((f, j) => (j === i ? { ...f, kind } : f)))
            }
            variant="text"
            ariaLabel={`Kind of ${field.label}`}
            className="shrink-0"
          />
          {canEdit && (
            <button
              type="button"
              aria-label={`Remove ${field.label}`}
              onClick={() => setTemplate(column.template.filter((_, j) => j !== i))}
              className={ROW_REMOVE_BUTTON}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <div className={PANEL_ADD_ROW}>
          <InlineUnderlineField
            label="New default field"
            value={newLabel}
            onChange={setNewLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") addField();
            }}
            className="w-40"
          />
          <SelectMenu
            value={newKind}
            options={KIND_OPTIONS}
            onChange={setNewKind}
            variant="text"
            ariaLabel="Field kind"
          />
          <button type="button" onClick={addField} className={cn(SMALL_TEXT_BUTTON, "gap-1")}>
            <Plus size={11} /> Add
          </button>
        </div>
      )}
    </PanelSection>
  );
}
