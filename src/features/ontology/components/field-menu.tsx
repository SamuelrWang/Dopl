"use client";

import { useRef, useState } from "react";
import { ListChecks, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { FormDialog, InlineUnderlineField, UnderlineField } from "@/shared/ui/form-dialog";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { cleanOptions, FIELD_DESCRIPTION_MAX } from "../field-kinds";
import { ROW_REMOVE_BUTTON } from "./panel-section";

/**
 * The ⋯ on a saved field row (Samuel, 2026-10-01: *"maybe a three-dot on each to
 * set descriptions"*). One menu for a template field and an object's attribute:
 * Edit description, Edit options (select fields only), Remove. A draft row keeps
 * its naked ✕ instead — it has no key yet, so there is nothing to describe.
 *
 * Coordinate mode, like `SelectMenu`: the panel scrolls and clips, and an
 * anchored card renders as a sliver.
 */
export function FieldMenu({
  label,
  description,
  options,
  onDescription,
  onOptions,
  onRemove,
}: {
  label: string;
  description: string;
  /** Present only for a select field — the menu offers "Edit options" then. */
  options?: string[];
  onDescription: (next: string) => void;
  onOptions?: (next: string[]) => void;
  onRemove: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<"description" | "options" | null>(null);

  const toggle = () => {
    if (at) return setAt(null);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAt({ x: rect.right - 180, y: rect.bottom + 4 });
  };
  const open = (which: "description" | "options") => {
    setAt(null);
    setDialog(which);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Field actions for ${label || "field"}`}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={toggle}
        className={cn(ROW_REMOVE_BUTTON, "focus-visible:opacity-100", at && "opacity-100")}
      >
        <MoreHorizontal size={12} />
      </button>
      <Popover open={at !== null} at={at ?? undefined} onClose={() => setAt(null)}>
        <MenuItem icon={<Pencil size={12} />} onSelect={() => open("description")}>
          Edit description
        </MenuItem>
        {options && onOptions && (
          <MenuItem icon={<ListChecks size={12} />} onSelect={() => open("options")}>
            Edit options
          </MenuItem>
        )}
        <MenuItem
          destructive
          icon={<Trash2 size={12} />}
          onSelect={() => {
            setAt(null);
            onRemove();
          }}
        >
          Remove field
        </MenuItem>
      </Popover>
      {dialog === "description" && (
        <DescriptionDialog
          label={label}
          initial={description}
          onClose={() => setDialog(null)}
          onSave={(next) => {
            setDialog(null);
            onDescription(next);
          }}
        />
      )}
      {dialog === "options" && options && onOptions && (
        <OptionsDialog
          label={label}
          initial={options}
          onClose={() => setDialog(null)}
          onSave={(next) => {
            setDialog(null);
            onOptions(next);
          }}
        />
      )}
    </>
  );
}

function DescriptionDialog({
  label,
  initial,
  onClose,
  onSave,
}: {
  label: string;
  initial: string;
  onClose: () => void;
  onSave: (next: string) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <FormDialog
      open
      onDiscard={onClose}
      title={label || "Field"}
      titleCase={false}
      closeLabel="Discard description"
      primary={{ label: "Save", onClick: () => onSave(text.trim()) }}
    >
      <UnderlineField
        id="field-description"
        label="Description"
        ariaLabel="Field description"
        value={text}
        onChange={setText}
        multiline
        minRows={2}
        maxLength={FIELD_DESCRIPTION_MAX}
        autoFocus
      />
    </FormDialog>
  );
}

/** The select field's choices, one line each. Blank and repeated lines are
 *  dropped on save (`field-kinds.ts › cleanOptions`), matching the server's rule. */
function OptionsDialog({
  label,
  initial,
  onClose,
  onSave,
}: {
  label: string;
  initial: string[];
  onClose: () => void;
  onSave: (next: string[]) => void;
}) {
  const [rows, setRows] = useState<string[]>(initial.length ? initial : [""]);
  return (
    <FormDialog
      open
      onDiscard={onClose}
      title={label || "Field"}
      titleCase={false}
      closeLabel="Discard options"
      primary={{ label: "Save", onClick: () => onSave(cleanOptions(rows)) }}
    >
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={i} className="group flex items-center gap-2">
            <InlineUnderlineField
              label="Option"
              value={row}
              autoFocus={i === rows.length - 1 && row === ""}
              onChange={(next) => setRows((r) => r.map((x, j) => (j === i ? next : x)))}
              onKeyDown={(e) => {
                if (e.key === "Enter") setRows((r) => [...r, ""]);
              }}
              className="flex-1"
            />
            <button
              type="button"
              aria-label={`Remove option ${row || i + 1}`}
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
              className={ROW_REMOVE_BUTTON}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((r) => [...r, ""])}
          className={cn(SMALL_TEXT_BUTTON, "gap-1 self-start")}
        >
          <Plus size={11} /> Add option
        </button>
      </div>
    </FormDialog>
  );
}
