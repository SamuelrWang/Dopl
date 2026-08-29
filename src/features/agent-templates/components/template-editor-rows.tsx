"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { RAISED_INPUT } from "@/shared/ui/wells";
import {
  OPEN_SCALE_ICON,
  OPEN_SCALE_ICON_ONLY,
  OpenScaleButton,
  OpenScaleIconButton,
} from "@/shared/ui/open-scale-button";
import {
  DialogActions,
  DialogField,
  DIALOG_BTN_PRIMARY,
  DIALOG_BTN_SECONDARY,
  StandardDialog,
} from "@/shared/ui/standard-dialog";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import type { TemplateField } from "../client/types";

/**
 * The editor's FIELD FURNITURE — the key/value rows and the knowledge-base
 * picker.
 *
 * ⚠ THE INPUT FACE IS `RAISED_WELL`'s `RAISED_INPUT`, THE KIT'S RAISED BLOCK
 * FIELD, and never `FIELD_WELL` / `.concave-field`. Samuel's ruling for this
 * page (2026-08-22): nothing on it is pressed in. Every text control here —
 * including the tall Instructions block — wears the same raised face, which is
 * also the composer's idiom (a `.bento`-class face with a transparent textarea
 * inside it). `template-editor.test.tsx › no concave surfaces` reads these
 * sources and fails on the well's class name, so the rule survives a
 * well-meaning "match the other dialogs" edit.
 *
 * ⚠ **`RAISED_INPUT` AND `Field` WERE PROMOTED OUT OF THIS FILE (2026-08-27)**
 * and are re-exported from here so the feature's other consumers
 * (`launch-sheet.tsx`, `template-approval.tsx`) keep one import path — the move
 * `ontology-bits` made for `FIELD_WELL`/`CHIP`/`RAISED_WELL`. This page was the
 * REFERENCE Samuel standardised the four /home dialogs onto, so the recipes are
 * now `shared/ui/wells.ts › RAISED_INPUT` and
 * `shared/ui/standard-dialog.tsx › DialogField`; a local copy here would be the
 * fifth statement of a face that exists to have exactly one.
 *
 * ⚠ **THE SMALL BUTTONS ARE THE KIT'S 26px PILL (Samuel, 2026-08-28)**, the
 * same ruling arriving on the BUTTONS that `RAISED_INPUT` settled for the
 * inputs. Add field, a row's Remove and the chip picker's Attach/Add-team each
 * hand-wrote their own height, radius and ink — THREE scales for one class of
 * control inside a single dialog. All three render
 * `shared/ui/open-scale-button.tsx` now, the KB card Open face that /home's
 * section buttons already wear, so this dialog cannot drift from that page by
 * an edit to either. Glyphs are sized with `OPEN_SCALE_ICON` /
 * `OPEN_SCALE_ICON_ONLY` rather than restating 12 and 14.
 *
 * ⚠ THE FOOTER PAIRS ARE NOT IN THAT RULING. `DIALOG_BTN_PRIMARY` /
 * `DIALOG_BTN_SECONDARY` are the `StandardDialog` contract — the rounded pair
 * every dialog in the tree closes with — and a 26px pill in that row would make
 * THIS dialog the one whose Cancel is a different size from every other's.
 */
export { RAISED_INPUT };
export { DialogField as Field };

/**
 * CUSTOM FIELDS — the pairs listed and edited INLINE, added through a dialog.
 *
 * ⚠ **ADDING IS A `StandardDialog` (Samuel, 2026-08-27), REVERSING THE
 * NO-MODAL-IN-MODAL RULING THIS FILE CARRIED.** The old note said a second
 * surface would put the operator two Escapes from their draft; what settled it
 * is that a field is about to be MORE than a key and a value (type, default,
 * required), and a row that grows four controls wide is a form pretending to be
 * a list. The dialog is the standard chrome at the standard width, so it is
 * ready for those settings without a second redesign.
 *
 * ⚠ EDITING AND REMOVING STAY INLINE. The dialog is for the pair that does not
 * exist yet; a pair on screen is cheaper to fix where it is than behind a
 * round trip through a modal.
 *
 * ⚠ AN EMPTY KEY IS STILL DROPPED AT SAVE (`../lib/template-draft.ts ›
 * cleanFields`) rather than blocked at the keystroke — the dialog's own Add
 * button is what refuses a blank one, and the draft rule stays the backstop.
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
          editor's own `ConfirmDialog` is the precedent. */}
      <StandardDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add field"
        closeLabel="Close add field"
      >
        <AddFieldForm
          key={session}
          onClose={() => setAdding(false)}
          onAdd={(field) => {
            setAdding(false);
            onChange([...fields, field]);
          }}
        />
      </StandardDialog>
    </div>
  );
}

/**
 * The dialog's BODY, mounted fresh per open (see `session` above) so the draft
 * pair is state that cannot outlive the surface that collected it.
 */
function AddFieldForm({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (field: TemplateField) => void;
}) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  // ⚠ THE KEY IS WHAT MAKES A PAIR REAL — a value with no key is dropped at
  // save (`../lib/template-draft.ts › cleanFields`), so adding one here would
  // be a row that disappears without a word.
  const canAdd = key.trim().length > 0;

  return (
    <>
      <DialogField label="Key" htmlFor="add-field-key">
        <input
          id="add-field-key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
          placeholder="e.g. escalation_channel"
          className={cn(RAISED_INPUT, "h-9 px-3 font-mono text-small")}
        />
      </DialogField>

      <DialogField label="Value" hint="(optional)" htmlFor="add-field-value">
        <input
          id="add-field-value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="What this field says"
          className={cn(RAISED_INPUT, "h-9 px-3")}
        />
      </DialogField>

      <DialogActions>
        <button type="button" className={DIALOG_BTN_SECONDARY} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={DIALOG_BTN_PRIMARY}
          disabled={!canAdd}
          onClick={() => onAdd({ key: key.trim(), value })}
        >
          {/* ⚠ "Add", not "Add field": the TITLE already says which thing, and
              two buttons reading "Add field" on one screen is an ambiguous
              accessible name for the operator and for every `getByRole`. */}
          Add
        </button>
      </DialogActions>
    </>
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
