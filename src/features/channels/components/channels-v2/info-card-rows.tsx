"use client";

/**
 * THE EDITABLE HALF OF A MAIN-INFO CARD — a custom `label: value` row, and the
 * discreet affordance that adds one (Samuel, 2026-08-25).
 *
 * ⚠ THE ADD AFFORDANCE IS NOT A BUTTON, and that is the ruling rather than a
 * style: "Add person" is a real black pill because it mints a credential that
 * reaches a person; adding a row to your own card is a note to yourself. It is
 * a ghost row at the END OF THE LIST, invisible until the section is hovered,
 * faint when it appears, and solid only under the cursor. A second pill beside
 * the first would make the two look like peers.
 *
 * ⚠ EDITING HAPPENS IN PLACE, ON THE UNDERLINE IDIOM `agent-rename.tsx`
 * ESTABLISHED — no box, no fill, no Save button, and the row does not change
 * height between reading and editing. A bordered field would push every row
 * below it down the moment you click, which on a card of five rows reads as the
 * panel jumping.
 *
 * ⚠ ENTER AND BLUR SAVE; ESCAPE CANCELS — the same three keys, for the same
 * reason that file gives: clicking away from a field you typed into means "keep
 * it" everywhere else in this product. ⚠ BLUR BETWEEN THE ROW'S OWN TWO FIELDS
 * IS NOT A BLUR: tabbing from label to value must not commit and re-render the
 * row out from under the caret, so the handler tests `relatedTarget` against
 * the row.
 *
 * ⚠ AN EMPTY LABEL IS A CANCEL, NOT AN EMPTY ROW. A row with nothing in the
 * left column states nothing and cannot be found again to delete. An empty
 * VALUE is fine — that is a row waiting for its answer.
 */

import { useRef, useState, type ReactNode } from "react";
import { CircleDashed, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MetaRow } from "./bits";
import {
  INFO_CARD_LABEL_MAX,
  INFO_CARD_VALUE_MAX,
  type ChannelInfoCardRow,
} from "../../info-card";

/**
 * THE HOVER GROUP the add affordance waits for, as a class pair.
 *
 * ⚠ NAMED, not the anonymous `group`. The rows inside this section already own
 * `group/meta` for their own × (`bits.tsx › MetaRow`), and Tailwind's unnamed
 * group would make a row's hover reveal the section's control as well.
 * `INFO_CARD_SECTION` goes on the element that wraps the whole list; nothing
 * else may wear it, or the affordance appears for the wrong region.
 */
export const INFO_CARD_SECTION = "group/infocard";

/** The underline field — the whole editing chrome there is. Shared by the two
 *  columns so a label and a value cannot drift apart typographically. */
const UNDERLINE_FIELD =
  "min-w-0 border-0 border-b border-text-primary bg-transparent p-0 text-body text-text-primary outline-none placeholder:text-text-disabled";

/**
 * One row, mid-edit. Pure UI: it owns the DRAFT and nothing else, and hands the
 * committed pair back. Persisting is the caller's problem.
 */
function RowEditor({
  label: initialLabel,
  value: initialValue,
  onCommit,
  onCancel,
}: {
  label: string;
  value: string;
  /** ⚠ Called with TRIMMED values, and never with an empty label. */
  onCommit: (label: string, value: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [value, setValue] = useState(initialValue);
  const rowRef = useRef<HTMLDivElement | null>(null);
  // ⚠ Guards the double-commit: Enter blurs the field, and the blur handler
  // would otherwise send the same pair a second time (`agent-rename.tsx`).
  const settled = useRef(false);

  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    const nextLabel = label.trim();
    if (nextLabel === "") {
      onCancel();
      return;
    }
    onCommit(nextLabel, value.trim());
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  return (
    <div
      ref={rowRef}
      className="flex h-9 items-center gap-2 rounded-[8px] px-2"
      // ⚠ FOCUS MOVING WITHIN THE ROW IS NOT LEAVING IT. Without this, Tab from
      // the label to the value commits, re-renders, and drops the caret.
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && rowRef.current?.contains(next)) return;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <CircleDashed size={14} className="shrink-0 text-text-muted" />
      {/* ⚠ `flex-1 min-w-0`, NOT a fixed `w-[92px]` (~12 chars): the label cap is
          40 chars (`INFO_CARD_LABEL_MAX`), and a 12-char field cannot show a
          label being edited. It takes the same horizontal band the read-mode
          `MetaRow` label truncates into, so the row does not change width between
          reading and editing (design system: same type, same footprint). */}
      <input
        autoFocus
        value={label}
        aria-label="Item label"
        maxLength={INFO_CARD_LABEL_MAX}
        spellCheck={false}
        placeholder="Label"
        onChange={(event) => setLabel(event.target.value)}
        className={cn(UNDERLINE_FIELD, "min-w-0 flex-1 text-small text-text-secondary")}
      />
      <input
        value={value}
        aria-label="Item value"
        maxLength={INFO_CARD_VALUE_MAX}
        spellCheck={false}
        placeholder="Value"
        onChange={(event) => setValue(event.target.value)}
        className={cn(UNDERLINE_FIELD, "w-[150px] text-right")}
      />
    </div>
  );
}

/**
 * ONE CUSTOM ROW. Reads as a `MetaRow` — same glyph column, same height, same
 * hover × — because a row the operator added is not a different KIND of row
 * from the ones that shipped.
 *
 * ⚠ THE GLYPH IS `CircleDashed` AND IT IS THE ONLY THING THAT MARKS THE ROW AS
 * CUSTOM. Built-ins carry a glyph that means something (`Mail`, `Clock3`); a
 * row whose meaning the operator wrote has no such glyph to draw, and inventing
 * one per label would be a guess rendered as a fact.
 */
export function InfoCardCustomRow({
  row,
  onChange,
  onRemove,
}: {
  row: ChannelInfoCardRow;
  onChange: (next: ChannelInfoCardRow) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <RowEditor
        label={row.label}
        value={row.value}
        onCommit={(label, value) => {
          setEditing(false);
          onChange({ ...row, label, value });
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <MetaRow icon={CircleDashed} label={row.label} onRemove={onRemove}>
      {/* ⚠ A BUTTON, not a div with an onClick: this is the edit affordance,
          and the row has no pencil — the value IS the target. Bare text so
          nothing about it reads as a control until you use it. */}
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${row.label}`}
        className="min-w-0 truncate text-body text-text-primary hover:text-link"
      >
        {row.value === "" ? "—" : row.value}
      </button>
    </MetaRow>
  );
}

/**
 * THE DISCREET ADD — a ghost row at the end of the list.
 *
 * ⚠ TWO STAGES, TWO ELEMENTS, AND THAT IS NOT AN ACCIDENT OF MARKUP. Presence
 * ("is the section hovered") is the WRAPPER's opacity; weight ("is the cursor
 * on ME") is the inner control's ink. Expressing both as opacity on one node
 * makes `hover:` and `group-hover/…` fight over the same property, and which
 * wins is Tailwind's emit order rather than a decision anybody made.
 *
 * ⚠ AT THE CAP IT RENDERS NOTHING. A control whose only outcome is a refusal is
 * a dead control — the same rule that hides "Add person" once a container is
 * full (`person-info-tab.tsx`).
 */
export function InfoCardAddRow({
  full,
  onAdd,
}: {
  /** The card already holds `INFO_CARD_MAX_ROWS` custom rows. */
  full: boolean;
  onAdd: (label: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (full) return null;
  if (editing) {
    return (
      <RowEditor
        label=""
        value=""
        onCommit={(label, value) => {
          setEditing(false);
          onAdd(label, value);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      data-testid="info-card-add"
      className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/infocard:opacity-100"
    >
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex h-9 w-full items-center gap-2 rounded-[8px] px-2 text-left text-text-disabled transition-colors hover:bg-surface-raised-1 hover:text-text-secondary"
      >
        <Plus size={14} className="shrink-0" />
        {/* ⚠ NO EXPLAINER. The glyph and the ellipsis are the whole label —
            "Add a custom item to this card" is the paragraph the minimal-copy
            ruling deletes. */}
        <span className="text-small">Add item</span>
      </button>
    </div>
  );
}

/** The list wrapper the add affordance's hover is keyed to. ⚠ Wrap the ROWS,
 *  not the whole tab: a section that includes the heading reveals the control
 *  from a hover that never entered the list. */
export function InfoCardSection({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(INFO_CARD_SECTION, className)}>{children}</div>
  );
}
