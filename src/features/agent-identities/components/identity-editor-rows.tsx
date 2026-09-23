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
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import type { IdentityField, IdentityFieldType } from "../client/types";
import {
  IDENTITY_FIELD_TYPES,
  IDENTITY_FIELD_TYPE_DEFAULT,
} from "../types";

/**
 * The editor's field furniture: the key/value rows and the chip picker. Nothing here is pressed in
 * (Samuel's ruling) — rows wear `RAISED_INPUT`, in-body buttons the kit's 26px pill;
 * `identity-editor-surface.test.tsx` sweeps this source for the banned recipes.
 */

/**
 * Custom fields listed and edited inline; the gray box appends a blank row (Samuel's ruling) and a
 * blank key is dropped at save (`cleanFields`), so an abandoned row costs nothing.
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
        // Keyed by index: keying by `field.key` would remount the input being typed into.
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
      <button
        type="button"
        onClick={() =>
          onChange([
            ...fields,
            // `text` is stamped on the draft row only; `cleanFields` sends it as absence.
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

/** Keyed by `IdentityFieldType`, so a type the schema accepts but the row cannot offer is a type error. */
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
 * The value control — the one thing the type changes. The stored value is a string on every branch;
 * `boolean` swaps to a yes/no select whose empty option stays (unanswered is not "no").
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
      // `url` stays a text box: `type="url"` would add browser validation the schema does not apply.
      type={type === "number" ? "number" : type === "date" ? "date" : "text"}
      value={field.value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={type === "url" ? "https://…" : "Value"}
      aria-label={label}
      className={cn(RAISED_INPUT, "h-8 flex-[3] px-2.5")}
    />
  );
}

/** One attached thing with its detach X — the chip both pickers draw, on the kit's `CHIP`. */
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
 * The team multi-select as chips — a replace-set of ids like the server's. It lists only what the
 * caller was given; `Popover` in coordinate mode because the editor body clips anchored panels.
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
  /** A fact, not a loading state — the caller passes `[]` only once its read has answered. */
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

  // The trigger comes from the event, not a ref (the kit pill forwards no ref).
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
