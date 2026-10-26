"use client";

/** The ontology board header's own controls: the description, the rename field, the display
 *  picker and the gear menu. Split from `ontology-view.tsx` for the 500-line cap. */

import { useRef, useState, type ReactNode } from "react";
import { Pencil, Settings, Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { InlineUnderlineField } from "@/shared/ui/form-dialog";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import { WHITE_PILL } from "@/shared/ui/page-action-button";
import { MenuDivider, MenuItem, Popover } from "@/shared/ui/popover-menu";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { useBoardDisplay, type BoardDisplay } from "../hooks/use-board-display";

/** Re-exported for the ontology callers that import it from here. */
export { InlineUnderlineField };

/**
 * The ontology's description as quiet inline text: no rule at rest, the ink line while it is being
 * edited. Saves through `ONTOLOGY_UPDATE` at `purpose`, which is what agents read.
 */
export function DescriptionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <InlineUnderlineField
      label="Description"
      value={value}
      onChange={onChange}
      quiet
      className="min-w-0 flex-1"
      inputClassName={fieldStyles.inputSecondary}
    />
  );
}

/**
 * The ontology's name while being renamed, in the switcher's slot. Enter and blur save; Escape and
 * an empty name cancel (a rename to "" would read as "Untitled" and hide a slipped keystroke).
 */
export function NameField({
  name,
  onCommit,
  onCancel,
}: {
  name: string;
  /** Never called with "". */
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const commit = () => {
    const next = draft.trim();
    if (next === "" || next === name) {
      onCancel();
      return;
    }
    onCommit(next);
  };
  return (
    <InlineUnderlineField
      label="Name"
      value={draft}
      onChange={setDraft}
      className="w-[220px] shrink-0"
      inputClassName="font-medium"
      autoFocus
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}

/**
 * The board's gear: one round white pill over every settings row. Rename is the view's; the rows
 * under the divider are the host's (/home's Share, Changelog and agents rungs). Delete is the last
 * row and one slot: a host that brings its own passes it in `hostRows` and no `onDelete`.
 *
 * Coordinate mode: inside `.page-float` a trigger-anchored panel renders as a clipped sliver.
 */
export function BoardSettingsMenu({
  ontologyName,
  onRename,
  hostRows,
  onDelete,
}: {
  ontologyName: string;
  /** Member+ only — a viewer gets the host's rows and no edits. */
  onRename?: () => void;
  hostRows?: (close: () => void) => ReactNode;
  /** Omit when `hostRows` supplies Delete. */
  onDelete?: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = () => setAnchor(null);
  const boardRows = Boolean(onRename);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title="Ontology settings"
        aria-label={`Settings for ${ontologyName || "ontology"}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => {
          if (anchor) {
            close();
            return;
          }
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ x: rect.right - 200, y: rect.bottom + 6 });
        }}
        className={cn(WHITE_PILL, "w-9 shrink-0 justify-center")}
      >
        <Settings size={14} />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={close}
        className="min-w-[200px]"
      >
        {onRename && (
          <MenuItem
            icon={<Pencil size={12} />}
            onSelect={() => {
              close();
              onRename();
            }}
          >
            Rename
          </MenuItem>
        )}
        {hostRows && (
          <>
            {boardRows && <MenuDivider />}
            {hostRows(close)}
          </>
        )}
        {onDelete && (
          <>
            {(boardRows || hostRows) && <MenuDivider />}
            <MenuItem
              destructive
              icon={<Trash2 size={12} />}
              onSelect={() => {
                close();
                onDelete();
              }}
            >
              Delete
            </MenuItem>
          </>
        )}
      </Popover>
    </>
  );
}

const DISPLAY_OPTIONS: ReadonlyArray<SelectMenuOption<BoardDisplay>> = [
  { value: "canvas", label: "Canvas", description: "Each object type is a lane of cards." },
  {
    value: "rows",
    label: "Rows",
    description: "Each object type spans the page, with every object as a row of its details.",
  },
];

/** The board's display picker, a white pill left of the gear. A view preference on this device,
 *  not an edit, so everyone may switch; the board reads the same store. */
export function BoardDisplayMenu() {
  const [value, onChange] = useBoardDisplay();
  return (
    <SelectMenu
      value={value}
      options={DISPLAY_OPTIONS}
      onChange={onChange}
      ariaLabel="Board display"
      variant="pill"
      className="shrink-0"
    />
  );
}
