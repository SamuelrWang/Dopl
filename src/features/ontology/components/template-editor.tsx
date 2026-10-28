"use client";

import { X } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { fieldKey } from "../field-kinds";
import type { GraphAction } from "../graph-state";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import type { OntologyObject, TemplateField } from "../types";
import { InlineUnderlineField } from "@/shared/ui/form-dialog";
import { FieldDescription, withDescription } from "./field-description";
import { FieldMenu } from "./field-menu";
import {
  PANEL_GRID,
  PANEL_ROW,
  SECTION_ROWS,
  PanelAddButton,
  PanelSection,
  ROW_REMOVE_BUTTON,
  useDraftRows,
} from "./panel-section";

/** Shared with the lane header's read-only template preview, so two renderings of a kind cannot
 *  drift. "Select", not "Enum": the word a person picks from; the stored kind stays `enum`. */
export const KIND_LABELS: Record<TemplateField["kind"], string> = {
  text: "Text",
  number: "Number",
  pill: "Tag",
  enum: "Select",
  date: "Date",
  link: "Link",
  ref: "Object",
  knowledge: "Knowledge",
  skill: "Skill",
};

type Kind = TemplateField["kind"];

/**
 * What a person may pick for a NEW field. Tag, Object and home-space Skill are retired from the
 * picker only: stored fields of those kinds still render and edit, and agents may still write them.
 */
const PICKABLE: readonly Kind[] = ["text", "number", "enum", "date", "link", "knowledge"];

/** The kind picker's rows for one field. A field already holding a retired kind keeps it as an
 *  option, else the trigger would misname it as the first row. */
export function useKindOptions(current: Kind): ReadonlyArray<SelectMenuOption<Kind>> {
  const { homeSpace } = useWorkspaceResources();
  const kinds: Kind[] = homeSpace ? [...PICKABLE] : [...PICKABLE, "skill"];
  if (!kinds.includes(current)) kinds.push(current);
  return kinds.map((value) => ({ value, label: KIND_LABELS[value] }));
}

/** The kind picker on a row: the `bare` face in muted regular ink, so it never competes with the
 *  value beside it. */
export const KIND_TRIGGER = "shrink-0 font-normal text-text-muted hover:text-text-primary";

/**
 * The type's default fields (label + kind, no values) every new child is born with. A field is
 * written on its label's blur or Enter, because a nameless field has no `key`. A draft whose label
 * matches an existing field updates that field instead of appending (MCP `set_template_field`'s
 * upsert-by-label).
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

  // Hoisted, not inlined in the key: `vocabulary.test.ts` reads every string literal in this
  // feature, and a template literal holding `column.template.length` is one of them.
  const saved = column.template.length;

  const setTemplate = (template: TemplateField[]) =>
    dispatch({ type: "OBJECT_UPDATE", id: column.id, patch: { template } });

  const addField = (index: number, row: Omit<TemplateField, "key">) => {
    const label = row.label.trim();
    if (!label) return;
    const needle = label.toLowerCase();
    const existing = column.template.find((f) => f.label.toLowerCase() === needle);
    setTemplate(
      existing
        ? column.template.map((f) => (f === existing ? { ...f, label, kind: row.kind } : f))
        : [...column.template, { key: fieldKey(label), label, kind: row.kind }]
    );
    drop(index);
  };

  return (
    <PanelSection
      label="Default fields"
      caption="New objects of this type start with these fields, ready to fill."
    >
      <div className={SECTION_ROWS}>
        {column.template.map((field, i) => (
          <FieldRow
            key={`row-${i}`}
            row={field}
            canEdit={canEdit}
            onChange={(next) =>
              setTemplate(column.template.map((f, j) => (j === i ? { ...f, ...next } : f)))
            }
            onRemove={() => setTemplate(column.template.filter((_, j) => j !== i))}
            saved
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

/** One default field, persisted or draft: one component for both, so a commit reconciles in
 *  place. A saved field gets the ⋯ menu, a draft the naked ✕. */
function FieldRow({
  row,
  canEdit,
  onChange,
  onCommit,
  onRemove,
  saved = false,
}: {
  row: Omit<TemplateField, "key">;
  canEdit: boolean;
  onChange: (row: Omit<TemplateField, "key">) => void;
  /** Draft only — fires on the label's blur and on Enter. */
  onCommit?: () => void;
  onRemove: () => void;
  saved?: boolean;
}) {
  const kindOptions = useKindOptions(row.kind);
  return (
    <div className={cn(PANEL_ROW, PANEL_GRID)}>
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
        className="min-w-0"
        inputClassName={fieldStyles.inputSecondary}
      />
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        <SelectMenu
          value={row.kind}
          options={kindOptions}
          disabled={!canEdit}
          onChange={(kind) => onChange({ ...row, kind })}
          variant="bare"
          ariaLabel="Field kind"
          className={cn(KIND_TRIGGER, "mr-auto")}
        />
        {canEdit && saved && (
          <FieldMenu
            label={row.label}
            description={row.description ?? ""}
            options={row.kind === "enum" ? (row.options ?? []) : undefined}
            onDescription={(description) => onChange(withDescription(row, description))}
            onOptions={(options) => onChange({ ...row, options })}
            onRemove={onRemove}
          />
        )}
        {canEdit && !saved && (
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
      <FieldDescription text={row.description} />
    </div>
  );
}
