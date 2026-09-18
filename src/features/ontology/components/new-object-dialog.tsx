"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { FormDialog, FormSection, UnderlineField } from "@/shared/ui/form-dialog";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { NEW_COLUMN_NAME, type ColumnDraftPatch } from "../optimistic-create";
import type { TemplateField } from "../types";
import { InlineUnderlineField } from "./board-header-bits";
import { FIELD_WELL } from "./ontology-bits";
import { KIND_LABELS } from "./template-editor";

/**
 * The "New object" popup (Samuel, 2026-09-11). The lane is already on the board
 * while this is open — the host begins a draft lane in the same click
 * (`optimistic-create.ts › beginColumnDraft`) and Discard withdraws it. This
 * component collects; it never creates.
 *
 * It wears the kit's face (`shared/ui/form-dialog.tsx`), re-cutting no control.
 *
 * Fields are the column's object template (`types.ts › TemplateField`: `key`,
 * `label`, `kind`) — no per-field description exists on that model and none is
 * invented here. The object's description is the `Description` field above.
 */
export function NewObjectDialog({
  open,
  onDiscard,
  onCreate,
}: {
  open: boolean;
  /** Discard, Escape, the backdrop and the × — one exit, the kit's rule. */
  onDiscard: () => void;
  onCreate: (patch: ColumnDraftPatch) => void;
}) {
  const [name, setName] = useState(NEW_COLUMN_NAME);
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FieldRow[]>([]);

  /**
   * Both exits clear, on the way out (`new-thread-dialog.tsx`'s rule). Resetting
   * here rather than in an open-effect avoids a setState-in-effect.
   */
  const reset = () => {
    setName(NEW_COLUMN_NAME);
    setDescription("");
    setFields([]);
  };

  /**
   * Focus + select from the DOM: `UnderlineField` takes no ref or `autoFocus`, and
   * the prefilled name must arrive selected so typing replaces it.
   */
  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(NAME_ID);
    if (el instanceof HTMLInputElement) {
      el.focus();
      el.select();
    }
  }, [open]);

  return (
    <FormDialog
      open={open}
      onDiscard={() => {
        reset();
        onDiscard();
      }}
      title="New object"
      closeLabel="Discard new object"
      primary={{
        label: "Create",
        onClick: () => {
          const patch = {
            // An empty name is the born name, never "": the lane's own header
            // would otherwise read as nothing at all.
            name: name.trim() || NEW_COLUMN_NAME,
            subtitle: description.trim(),
            template: toTemplate(fields),
          };
          reset();
          onCreate(patch);
        },
      }}
    >
      <UnderlineField
        id={NAME_ID}
        label="Name"
        ariaLabel="New object name"
        value={name}
        onChange={setName}
      />
      <UnderlineField
        id="new-object-description"
        label="Description"
        ariaLabel="New object description"
        value={description}
        onChange={setDescription}
        multiline
        minRows={2}
      />
      <FormSection label="Fields" caption="new objects start with these">
        <div className="flex flex-col gap-2">
          {fields.map((field, i) => (
            <div key={field.rowId} className="flex items-center gap-2">
              <InlineUnderlineField
                label="Field"
                value={field.label}
                onChange={(label) =>
                  setFields((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, label } : r))
                  )
                }
                className="flex-1"
              />
              <select
                value={field.kind}
                aria-label={`Kind of field ${i + 1}`}
                onChange={(e) =>
                  setFields((rows) =>
                    rows.map((r, j) =>
                      j === i
                        ? { ...r, kind: e.target.value as TemplateField["kind"] }
                        : r
                    )
                  )
                }
                className={`${FIELD_WELL} h-7 shrink-0 px-1.5 text-small text-text-secondary`}
              >
                {Object.entries(KIND_LABELS).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Remove field ${i + 1}`}
                onClick={() =>
                  setFields((rows) => rows.filter((_, j) => j !== i))
                }
                className="shrink-0 rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setFields((rows) => [
                ...rows,
                { rowId: nextRowId(), label: "", kind: "text" },
              ])
            }
            className={`${SMALL_TEXT_BUTTON} gap-1 self-start`}
          >
            <Plus size={12} aria-hidden="true" /> Field
          </button>
        </div>
      </FormSection>
    </FormDialog>
  );
}

const NAME_ID = "new-object-name";

/** A row while it is being typed. `rowId` is a React key and nothing else —
 *  keying on the label would remount the input on every keystroke. */
interface FieldRow {
  rowId: string;
  label: string;
  kind: TemplateField["kind"];
}

let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `field-${rowSeq}`;
}

/**
 * Rows → the stored template. Same key derivation as `TemplateEditor` (label
 * lowercased, spaces hyphenated) so a field added here and one added in the panel
 * are the same field; blank rows are dropped.
 */
function toTemplate(rows: readonly FieldRow[]): TemplateField[] {
  const template: TemplateField[] = [];
  for (const row of rows) {
    const label = row.label.trim();
    if (label === "") continue;
    const key = label.toLowerCase().replace(/\s+/g, "-");
    if (template.some((f) => f.key === key)) continue;
    template.push({ key, label, kind: row.kind });
  }
  return template;
}
