"use client";

import { useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { RAISED_WELL } from "@/shared/ui/wells";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import type { TemplateField } from "../client/types";

/**
 * The editor's FIELD FURNITURE — the label wrapper, the input face, the
 * key/value rows and the knowledge-base picker.
 *
 * ⚠ THE INPUT FACE IS `RAISED_WELL`, THE KIT'S RAISED BLOCK FIELD, and never
 * `FIELD_WELL` / `.concave-field`. Samuel's ruling for this page (2026-08-22):
 * nothing on it is pressed in. Every text control here — including the tall
 * Instructions block — wears the same raised face, which is also the composer's
 * idiom (a `.bento`-class face with a transparent textarea inside it).
 * `template-editor.test.tsx › no concave surfaces` reads these sources and fails
 * on the well's class name, so the rule survives a well-meaning "match the other
 * dialogs" edit.
 */

/** THE one input recipe on this page. Compose padding/type on top; never fork. */
export const RAISED_INPUT = cn(
  RAISED_WELL,
  "w-full text-body text-text-primary outline-none transition-colors",
  "placeholder:text-text-muted focus:border-border-highlight"
);

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** ⚠ A WORD OR TWO, never a sentence (INVARIANTS §5, minimal copy). */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-label font-semibold uppercase tracking-wide text-text-secondary"
      >
        {label}
        {hint && <span className="ml-1 font-normal normal-case text-text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * CUSTOM FIELDS — key/value rows, added and removed INLINE.
 *
 * ⚠ NO MODAL-IN-MODAL. A dialog opened over the editor to add one pair would put
 * the operator two Escapes from their draft and give the second surface its own
 * cancel semantics; the rows are cheap enough to edit in place, and an empty key
 * is dropped at save (`../lib/template-draft.ts › cleanFields`) rather than
 * blocked at the keystroke.
 */
export function CustomFieldRows({
  fields,
  onChange,
}: {
  fields: ReadonlyArray<TemplateField>;
  onChange: (next: TemplateField[]) => void;
}) {
  function edit(index: number, patch: Partial<TemplateField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      {fields.map((field, index) => (
        // ⚠ KEYED BY INDEX ON PURPOSE. A row has no id until it is saved, and
        // keying by `field.key` would remount the very input the operator is
        // typing that key into — losing focus on every character.
        <div key={index} className="flex items-center gap-1.5">
          <input
            value={field.key}
            onChange={(e) => edit(index, { key: e.target.value })}
            placeholder="Key"
            aria-label={`Field ${index + 1} key`}
            className={cn(RAISED_INPUT, "h-8 flex-[2] px-2.5 font-mono text-small")}
          />
          <input
            value={field.value}
            onChange={(e) => edit(index, { value: e.target.value })}
            placeholder="Value"
            aria-label={`Field ${index + 1} value`}
            className={cn(RAISED_INPUT, "h-8 flex-[3] px-2.5")}
          />
          <button
            type="button"
            onClick={() => onChange(fields.filter((_, i) => i !== index))}
            aria-label={`Remove field ${index + 1}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...fields, { key: "", value: "" }])}
        className="btn-light flex h-8 w-fit items-center gap-1.5 rounded-lg px-2.5 text-small font-medium text-text-primary"
      >
        <Plus size={13} />
        Add field
      </button>
    </div>
  );
}

export interface PickerOption {
  id: string;
  name: string;
}

/**
 * A MULTI-SELECT AS CHIPS — the picked ones inline, the rest behind one button.
 *
 * ⚠ ONE COMPONENT FOR TEAMS AND FOR KNOWLEDGE BASES, because the server models
 * both as a REPLACE-SET of ids (`../schema.ts`: "there is no add/remove verb,
 * because a partial mutation over a set that two clients can edit is how sets
 * silently diverge"). A single-value team control would have to pick one on read
 * and drop the rest on the next save.
 *
 * ⚠ IT LISTS WHAT THE CALLER WAS GIVEN and resolves no visibility of its own —
 * the page supplies the options from the teams and knowledge reads. A second
 * opinion about which teams a member may share with is the two-readers-one-fact
 * defect with an ACCESS GRANT as the thing that drifts.
 *
 * ⚠ `Popover` in COORDINATE mode, like `SelectMenu` — the editor is a scrolling,
 * overflow-clipping modal body, where a trigger-anchored panel renders as a
 * clipped sliver.
 */
export function ChipMultiSelect({
  options,
  selectedIds,
  onChange,
  addLabel,
  detachVerb,
  emptyLine,
}: {
  options: ReadonlyArray<PickerOption>;
  selectedIds: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  /** The picker button's word ("Attach", "Add team"). */
  addLabel: string;
  /** Screen-reader verb on a chip's X ("Detach", "Remove"). */
  detachVerb: string;
  /** ⚠ A FACT about the workspace, not a loading state — the caller passes `[]`
   *  only once its own read has answered. */
  emptyLine: string;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const selected = new Set(selectedIds);
  const attached = options.filter((o) => selected.has(o.id));

  function toggle(id: string) {
    onChange(
      selected.has(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]
    );
  }

  function openPicker() {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left, y: rect.bottom + 4 });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attached.map((option) => (
        <span
          key={option.id}
          className="flex items-center gap-1 rounded-full border border-border-strong bg-bg-elevated px-2.5 py-0.5 text-small font-medium text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
        >
          {option.name}
          <button
            type="button"
            onClick={() => toggle(option.id)}
            aria-label={`${detachVerb} ${option.name}`}
            className="text-text-muted transition-colors hover:text-text-primary"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <button
        ref={triggerRef}
        type="button"
        onClick={openPicker}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={options.length === 0}
        className="btn-light flex h-7 items-center gap-1.5 rounded-full px-2.5 text-small font-medium text-text-primary disabled:opacity-40"
      >
        <Plus size={13} />
        {addLabel}
      </button>
      {options.length === 0 && (
        <span className="text-caption text-text-muted">{emptyLine}</span>
      )}
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={() => setAnchor(null)}
        className="max-h-[280px] min-w-[240px] overflow-y-auto"
      >
        {options.map((option) => (
          <MenuItem
            key={option.id}
            showCheck
            active={selected.has(option.id)}
            onSelect={() => toggle(option.id)}
          >
            {option.name}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}
