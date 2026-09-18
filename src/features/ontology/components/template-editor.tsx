"use client";

import { X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import type { GraphAction } from "../graph-state";
import type { OntologyObject, TemplateField } from "../types";
import { InlineUnderlineField } from "./board-header-bits";
import {
  PANEL_ROW,
  PANEL_ROWS,
  PanelAddButton,
  PanelSection,
  ROW_REMOVE_BUTTON,
  useDraftRows,
} from "./panel-section";

/** Shared with the column header card's read-only template preview — two
 *  renderings of a field's kind must not drift. */
export const KIND_LABELS: Record<TemplateField["kind"], string> = {
  text: "Text",
  pill: "Tag",
  ref: "Object",
  knowledge: "Knowledge",
  skill: "Skill",
};

/** One declaration, so the template's kind picker and the attributes' cannot
 *  offer different words for one kind. No `description`: a second line per option
 *  in a 420px panel is the paragraph the minimal-copy ruling refuses. */
export const KIND_OPTIONS: ReadonlyArray<SelectMenuOption<TemplateField["kind"]>> =
  Object.entries(KIND_LABELS).map(([value, label]) => ({
    value: value as TemplateField["kind"],
    label,
  }));

/**
 * The column's object template — default fields (label + kind, no values) every
 * new child is born with. Not the attributes editor: rows are field definitions,
 * so there is no value cell.
 *
 * Flat since 2026-09-12, and one white bar per field on a gray well since
 * 2026-09-13 — the same recipe the other three sections took, and not a return of
 * the frame (`panel-section.tsx › PanelSection`). `+ Add` appends an empty bar;
 * the field is written on the label's blur (or Enter), because a nameless default
 * field has no `key` to be addressed by.
 *
 * A draft whose label matches an existing field updates that field instead of
 * appending (`addField`'s upsert-by-label), so the new bar disappears and the row
 * above it takes the kind.
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
  const { drafts, add, patch, drop } = useDraftRows<Omit<TemplateField, "key">>(() => ({
    label: "",
    kind: "text",
  }));

  // Hoisted, not inlined in the key: `vocabulary.test.ts` reads every string
  // literal in this feature for the words the reader must never see, and a
  // template literal holding `column.template.length` is one of them.
  const saved = column.template.length;

  const setTemplate = (template: TemplateField[]) =>
    dispatch({ type: "OBJECT_UPDATE", id: column.id, patch: { template } });

  // Upsert by label (case-insensitive) to match MCP `set_template_field`
  // semantics — no duplicate default fields.
  const addField = (index: number, row: Omit<TemplateField, "key">) => {
    const label = row.label.trim();
    if (!label) return;
    const needle = label.toLowerCase();
    const existing = column.template.find((f) => f.label.toLowerCase() === needle);
    setTemplate(
      existing
        ? column.template.map((f) => (f === existing ? { ...f, label, kind: row.kind } : f))
        : [
            ...column.template,
            { key: label.toLowerCase().replace(/\s+/g, "-"), label, kind: row.kind },
          ]
    );
    drop(index);
  };

  return (
    <PanelSection label="Default fields">
      <p className="text-caption text-text-muted">
        New objects of this type start with these fields, ready to fill.
      </p>
      <div className={PANEL_ROWS}>
        {column.template.map((field, i) => (
          <FieldRow
            key={`row-${i}`}
            row={field}
            canEdit={canEdit}
            onChange={(next) =>
              setTemplate(column.template.map((f, j) => (j === i ? { ...f, ...next } : f)))
            }
            onRemove={() => setTemplate(column.template.filter((_, j) => j !== i))}
          />
        ))}
        {drafts.map((row, n) => (
          <FieldRow
            key={`row-${saved + n}`}
            row={row}
            canEdit={canEdit}
            onChange={(next) => patch(n, next)}
            onCommit={() => addField(n, row)}
            onRemove={() => drop(n)}
          />
        ))}
        {canEdit && <PanelAddButton onClick={add} />}
      </div>
    </PanelSection>
  );
}

/**
 * One default field, persisted or draft — one component for both, so a commit
 * reconciles in place (`panel-section.tsx › useDraftRows`).
 *
 * Fields are `quiet` since 2026-09-14: the kit's `.inputQuiet`, a resting state of
 * the one underline recipe (`board-header-bits.tsx › InlineUnderlineField`), not
 * a second face. The panel's own description keeps its gray-at-rest line; the rule
 * is about row cells.
 *
 * Order untouched: a template row is a field definition — label + kind, no value
 * — so there is no value cell for the `Attribute : value dropdown` ruling to put
 * the picker after.
 */
function FieldRow({
  row,
  canEdit,
  onChange,
  onCommit,
  onRemove,
}: {
  row: Omit<TemplateField, "key">;
  canEdit: boolean;
  onChange: (row: Omit<TemplateField, "key">) => void;
  /** Draft only — fires on the label's blur and on Enter. */
  onCommit?: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={cn(PANEL_ROW, "group flex flex-wrap items-center gap-2")}>
      <InlineUnderlineField
        label="Field label"
        value={row.label}
        readOnly={!canEdit}
        quiet
        onChange={(label) => onChange({ ...row, label })}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit?.();
        }}
        className="min-w-0 flex-1"
      />
      <SelectMenu
        value={row.kind}
        options={KIND_OPTIONS}
        disabled={!canEdit}
        onChange={(kind) => onChange({ ...row, kind })}
        variant="text"
        ariaLabel="Field kind"
        className="shrink-0"
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
  );
}
