"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CHIP, RAISED_INPUT } from "@/shared/ui/wells";
import {
  OPEN_SCALE_ICON,
  OPEN_SCALE_ICON_ONLY,
  OpenScaleButton,
  OpenScaleIconButton,
} from "@/shared/ui/open-scale-button";
import { DialogField } from "@/shared/ui/standard-dialog";
import { FormDialog, UnderlineField } from "@/shared/ui/form-dialog";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import type { TemplateField } from "../client/types";

/**
 * The editor's FIELD FURNITURE — the key/value rows and the chip picker.
 *
 * 🔒 **NOTHING ON THIS PAGE IS PRESSED IN (Samuel, 2026-08-22).** Two raised
 * faces, not one: a popup FORM field is `shared/ui/form-dialog.tsx ›
 * UnderlineField` (since 2026-09-08), and the repeating key/value LIST — no
 * `FormSection` of its own — wears `shared/ui/wells.ts › RAISED_INPUT`. Never
 * `FIELD_WELL` / `.concave-field`: `template-editor-surface.test.tsx` reads this
 * source and fails on the banned class name.
 *
 * 🔒 **IN-BODY BUTTONS ARE THE KIT'S 26px PILL (Samuel, 2026-08-28)** —
 * `shared/ui/open-scale-button.tsx`, the Open face /home's section buttons
 * already wear, so Add field, a row's Remove and the picker's Attach cannot
 * drift back into three scales inside one dialog. Glyphs size off
 * `OPEN_SCALE_ICON` / `OPEN_SCALE_ICON_ONLY`.
 * ⚠ The FOOTER pair is outside that ruling — it is `FormDialog`'s, at
 * `--action-h-sm`, so this dialog closes like every other popup form.
 *
 * ⚠ `RAISED_INPUT` and `Field` are RE-EXPORTED from here (promoted to the kit
 * 2026-08-27) so `launch-sheet.tsx` and `template-approval.tsx` keep one import
 * path.
 */
export { RAISED_INPUT };
export { DialogField as Field };

/**
 * CUSTOM FIELDS — the pairs listed and edited INLINE, added through a
 * `FormDialog` (Samuel, 2026-08-27; a `FormDialog` since 2026-09-08).
 *
 * ⚠ ADDING IS A DIALOG because a field is about to be more than a key and a
 * value (type, default, required), and a row four controls wide is a form
 * pretending to be a list. Editing and removing stay inline — a pair already on
 * screen is cheaper to fix where it is than behind a modal round trip.
 *
 * ⚠ An empty key is dropped at SAVE (`../lib/template-draft.ts › cleanFields`),
 * not at the keystroke; the dialog's own Add button refuses a blank one.
 */
export function CustomFieldRows({
  fields,
  onChange,
}: {
  fields: ReadonlyArray<TemplateField>;
  onChange: (next: TemplateField[]) => void;
}) {
  // ⚠ TWO PIECES OF STATE, NOT ONE. `adding` drives the modal's fade; `session`
  // is bumped only on the way IN, and it is what remounts the form. Keying the
  // form on `adding` alone would also remount on the way OUT — blanking the
  // inputs on screen while the card is still fading.
  const [adding, setAdding] = useState(false);
  const [session, setSession] = useState(0);

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
          <OpenScaleIconButton
            onClick={() => onChange(fields.filter((_, i) => i !== index))}
            aria-label={`Remove field ${index + 1}`}
            className="shrink-0"
          >
            <X size={OPEN_SCALE_ICON_ONLY} aria-hidden="true" />
          </OpenScaleIconButton>
        </div>
      ))}
      {/* ⚠ `w-fit` IS THE CALLER'S, and it has to be: the pill is
          `inline-flex`, but this column is a flex container, so a stretched
          item would run the width of the dialog. Layout beyond the pill's own
          inline row stays with the caller (`shared/ui/open-scale-button.tsx`). */}
      <OpenScaleButton
        onClick={() => {
          setSession((n) => n + 1);
          setAdding(true);
        }}
        className="w-fit"
      >
        <Plus size={OPEN_SCALE_ICON} aria-hidden="true" />
        Add field
      </OpenScaleButton>
      {/* ⚠ A DIALOG OVER A DIALOG, and `ModalShell` portals to `document.body`,
          so the card is NOT clipped by the editor's scrolling body. The
          editor's own `ConfirmDialog` is the precedent.
          ⚠ **THE WHOLE DIALOG IS KEYED NOW, NOT ONLY ITS BODY (2026-09-08).**
          The kit puts the verb on the SHELL, so the shell is what holds the
          pair — and `session` still bumps only on the way IN, so the exit fade
          plays with the typed values still on screen. */}
      <AddFieldDialog
        key={session}
        open={adding}
        onDiscard={() => setAdding(false)}
        onAdd={(field) => {
          setAdding(false);
          onChange([...fields, field]);
        }}
      />
    </div>
  );
}

/**
 * ADD A FIELD — its own popup form, mounted fresh per open (see `session`
 * above) so the draft pair is state that cannot outlive the surface that
 * collected it.
 *
 * ⚠ **IT IS A `FormDialog` LIKE EVERY OTHER DIALOG THAT COLLECTS INPUT**
 * (2026-09-08; `docs/DESIGN-SYSTEM.md` › Popup forms). A `StandardDialog` with
 * two `RAISED_INPUT` boxes and a Cancel/Add pair was the pre-kit face of the
 * same two questions.
 */
function AddFieldDialog({
  open,
  onDiscard,
  onAdd,
}: {
  open: boolean;
  onDiscard: () => void;
  onAdd: (field: TemplateField) => void;
}) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  // ⚠ THE KEY IS WHAT MAKES A PAIR REAL — a value with no key is dropped at
  // save (`../lib/template-draft.ts › cleanFields`), so adding one here would
  // be a row that disappears without a word.
  const canAdd = key.trim().length > 0;

  return (
    <FormDialog
      open={open}
      onDiscard={onDiscard}
      title="Add field"
      closeLabel="Close add field"
      primary={{
        // ⚠ "Add", not "Add field": the TITLE already says which thing, and
        // two buttons reading "Add field" on one screen is an ambiguous
        // accessible name for the operator and for every `getByRole`.
        label: "Add",
        onClick: () => onAdd({ key: key.trim(), value }),
        disabled: !canAdd,
      }}
    >
      <UnderlineField
        id="add-field-key"
        label="Key"
        ariaLabel="Field key"
        value={key}
        onChange={setKey}
      />
      <UnderlineField
        id="add-field-value"
        label="Value"
        caption="optional"
        ariaLabel="Field value"
        value={value}
        onChange={setValue}
      />
    </FormDialog>
  );
}

/**
 * ONE ATTACHED THING, with the X that detaches it — the chip both pickers draw
 * (`ChipMultiSelect` below, `knowledge-scope-picker.tsx` beside it).
 *
 * ⚠ THE FACE IS THE KIT'S `CHIP` (`shared/ui/wells.ts`), not a recipe restated
 * here: the two pickers had the same class string twice and a retune would have
 * reached one of them.
 */
export function RemovableChip({
  label,
  detachLabel,
  onDetach,
}: {
  label: string;
  /** Screen-reader name for the X — the caller owns the verb ("Detach", "Remove"). */
  detachLabel: string;
  onDetach: () => void;
}) {
  return (
    <span className={cn("flex items-center gap-1", CHIP)}>
      {label}
      <button
        type="button"
        onClick={onDetach}
        aria-label={detachLabel}
        className="text-text-muted transition-colors hover:text-text-primary"
      >
        <X size={12} />
      </button>
    </span>
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
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const selected = new Set(selectedIds);
  const attached = options.filter((o) => selected.has(o.id));

  function toggle(id: string) {
    onChange(
      selected.has(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]
    );
  }

  // ⚠ THE TRIGGER ARRIVES FROM THE EVENT, not from a ref. Same element, same
  // rect — and the pill is a shared component whose props are the button's own
  // attributes, so a `ref` through it would be a widening of the kit for one
  // measurement this handler already has in `currentTarget`.
  function openPicker(trigger: HTMLButtonElement) {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setAnchor({ x: rect.left, y: rect.bottom + 4 });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attached.map((option) => (
        <RemovableChip
          key={option.id}
          label={option.name}
          detachLabel={`${detachVerb} ${option.name}`}
          onDetach={() => toggle(option.id)}
        />
      ))}
      {/* ⚠ `disabled:opacity-40` STAYS WITH THE CALLER — the pill is the face
          and the scale, nothing else, exactly as `/home`'s create button keeps
          its own `disabled:opacity-60`. */}
      <OpenScaleButton
        onClick={(e) => openPicker(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={options.length === 0}
        className="disabled:opacity-40"
      >
        <Plus size={OPEN_SCALE_ICON} aria-hidden="true" />
        {addLabel}
      </OpenScaleButton>
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
