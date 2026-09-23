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
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import type { IdentityField, IdentityFieldType } from "../client/types";
import {
  IDENTITY_FIELD_TYPES,
  IDENTITY_FIELD_TYPE_DEFAULT,
} from "../types";

/**
 * The editor's FIELD FURNITURE — the key/value rows and the chip picker.
 *
 * 🔒 **NOTHING ON THIS PAGE IS PRESSED IN (Samuel, 2026-08-22).** Two raised
 * faces, not one: a popup FORM field is `shared/ui/form-dialog.tsx ›
 * UnderlineField` (since 2026-09-08), and the repeating key/value LIST — no
 * `FormSection` of its own — wears `shared/ui/wells.ts › RAISED_INPUT`. Never
 * `FIELD_WELL` / `.concave-field`: `identity-editor-surface.test.tsx` reads this
 * source and fails on the banned class name.
 *
 * 🔒 **IN-BODY BUTTONS ARE THE KIT'S 26px PILL (Samuel, 2026-08-28)** —
 * `shared/ui/open-scale-button.tsx`, the Open face /home's section buttons
 * already wear, so a row's Remove and the picker's Attach cannot drift back into
 * three scales inside one dialog. Glyphs size off `OPEN_SCALE_ICON` /
 * `OPEN_SCALE_ICON_ONLY`. ⚠ **THE FIELD LIST'S OWN ADD IS NOT ON THAT FACE SINCE
 * 2026-09-22** — Samuel ruled it a full-width GRAY BOX, which is a different
 * thing from a pill beside a row; see {@link CustomFieldRows}.
 * ⚠ The FOOTER pair is outside that ruling — it is `FormDialog`'s, at
 * `--action-h-sm`, so this dialog closes like every other popup form.
 *
 * ⚠ `RAISED_INPUT` and `Field` are RE-EXPORTED from here (promoted to the kit
 * 2026-08-27) so this feature's dialogs keep one import path. ⚠ **THAT WAS TWO
 * READERS AND IS ONE SINCE 2026-09-13** — `identity-approval.tsx`; the launch
 * sheet was DELETED by Samuel's one-launch-surface ruling (INVARIANTS §5A), and
 * the New agent popup wears the POPUP kit's underline instead
 * (`shared/ui/form-dialog.tsx › UnderlineField`), which is a different recipe.
 */
export { RAISED_INPUT };
export { DialogField as Field };

/**
 * CUSTOM FIELDS — the pairs listed, added and edited INLINE.
 *
 * 🔒 **THE ADD DIALOG IS GONE (Samuel, 2026-09-22: *"right now it's like a
 * button. I don't like that … instead a gray box button that says New field"*,
 * and a new identity *"should have an existing blank field that is already in,
 * just have it blank"*).** ⚠ **THE NOTE THAT STOOD HERE ARGUED THE OPPOSITE AND
 * ITS PREMISE NEVER ARRIVED**: adding was a dialog *"because a field is about to
 * be more than a key and a value (type, default, required), and a row four
 * controls wide is a form pretending to be a list."* A year on, a field is still
 * a key and a value — so the modal was a round trip charged for a column that
 * does not exist, on the one control an operator uses most in this form.
 *
 * ⚠ **A ROW IS ADDED BY TYPING IN ONE, NOT BY COMMITTING A FORM.** The gray box
 * appends a BLANK row and nothing else, which is why there is no Add verb and
 * nothing to refuse: an empty key is dropped at SAVE
 * (`../lib/identity-draft.ts › cleanFields`), so a row the operator opened and
 * abandoned costs nothing and is never written.
 * ⚠ **AND THE FIRST ROW IS ALREADY THERE ON A NEW IDENTITY** — `emptyDraft()`,
 * not this component: a starter row is a fact about a DRAFT, and putting it here
 * would also paint one over a saved identity that has no fields, where it would
 * read as a field somebody removed.
 */
export function CustomFieldRows({
  fields,
  onChange,
}: {
  fields: ReadonlyArray<IdentityField>;
  onChange: (next: IdentityField[]) => void;
}) {
  function edit(index: number, patch: Partial<IdentityField>) {
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
          <FieldValueInput
            field={field}
            index={index}
            onChange={(value) => edit(index, { value })}
          />
          {/* 🔒 **THE TYPE (Samuel, 2026-09-22), THIRD IN THE ROW.** It says how
              the VALUE is typed and nothing else — the value is a string on every
              branch and the launch splice reads the same `key: value` line it
              always did (`../types.ts › IdentityFieldType` carries the scope and
              what was deliberately left out of it).
              ⚠ THE DIALOG DROPDOWN'S OWN FACE (`variant="raised"`), so the row's
              three controls are one recipe rather than an input, an input and a
              pill. */}
          <SelectMenu
            value={field.type ?? IDENTITY_FIELD_TYPE_DEFAULT}
            options={FIELD_TYPE_OPTIONS}
            onChange={(type) => edit(index, { type })}
            ariaLabel={`Field ${index + 1} type`}
            variant="raised"
            className="h-8 shrink-0"
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
      {/* 🔒 **THE GRAY BOX (Samuel, 2026-09-22)** — full width, the flat inset
          fill, and the WHOLE of it presses. It is not the kit's 26px pill: that
          face is for a control sitting BESIDE something (a row's Remove, a
          card's Open), and this one is the last row of a list, reading as the
          empty slot the next field goes in.
          ⚠ FLAT, NEVER PRESSED IN — `bg-bg-inset` and nothing else. The
          pressed-in field recipe here is a regression with a source scan behind
          it (`identity-editor-surface.test.tsx`), which reads this file for the
          banned class NAMES — so this note may not spell one either. */}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...fields,
            // ⚠ THE DEFAULT IS STAMPED ON THE DRAFT ROW AND NOT ON THE WIRE:
            // `cleanFields` drops it again on the way out, so `text` still
            // travels as ABSENCE.
            { key: "", value: "", type: IDENTITY_FIELD_TYPE_DEFAULT },
          ])
        }
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg bg-bg-inset px-2.5 py-2 text-left text-caption text-text-muted transition-colors hover:bg-bg-inset-hover"
      >
        <Plus size={OPEN_SCALE_ICON} aria-hidden="true" />
        New field
      </button>
    </div>
  );
}

/**
 * THE FIVE SHAPES, LABELLED FOR A PERSON. ⚠ Derived from `../types.ts ›
 * IDENTITY_FIELD_TYPES` rather than hand-listed, so a value the schema accepts
 * and the row cannot offer is a TYPE ERROR rather than a missing option.
 */
const FIELD_TYPE_LABELS: Record<IdentityFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes / no",
  url: "Link",
};

const FIELD_TYPE_OPTIONS: ReadonlyArray<SelectMenuOption<IdentityFieldType>> =
  IDENTITY_FIELD_TYPES.map((value) => ({
    value,
    label: FIELD_TYPE_LABELS[value],
  }));

/**
 * THE VALUE CONTROL — the one thing the type actually changes.
 *
 * ⚠ **THE STORED VALUE IS A STRING ON EVERY BRANCH.** `number` and `date` are
 * native input types, which is a KEYBOARD and a picker rather than a contract:
 * the browser hands back a string, the schema takes a string, and the launch
 * payload splices the same line. Nothing here validates, and nothing should —
 * the server refusing "n/a" in a `number` field would be enforcing a rule no
 * reader downstream honours.
 * ⚠ **`boolean` IS THE ONE THAT SWAPS THE ELEMENT**, because there is no input
 * type for a yes/no and a free-text box is how a field ends up holding "yes",
 * "Y" and "true" in three identities. Its stored values are `"yes"` / `"no"`, and
 * the EMPTY option stays — a yes/no nobody has answered is not a "no".
 */
function FieldValueInput({
  field,
  index,
  onChange,
}: {
  field: IdentityField;
  index: number;
  onChange: (next: string) => void;
}) {
  const label = `Field ${index + 1} value`;
  const type = field.type ?? IDENTITY_FIELD_TYPE_DEFAULT;
  if (type === "boolean") {
    return (
      <select
        value={field.value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(RAISED_INPUT, "h-8 flex-[3] px-2.5")}
      >
        <option value="">—</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  }
  return (
    <input
      // ⚠ `url` STAYS A TEXT BOX. `type="url"` adds browser VALIDATION (and a
      // refusal at submit) to a field whose value this product does not parse,
      // so it would be the one branch that can refuse what the schema accepts.
      type={type === "number" ? "number" : type === "date" ? "date" : "text"}
      value={field.value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={type === "url" ? "https://…" : "Value"}
      aria-label={label}
      className={cn(RAISED_INPUT, "h-8 flex-[3] px-2.5")}
    />
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
