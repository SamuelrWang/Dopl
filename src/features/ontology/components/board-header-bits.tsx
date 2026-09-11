"use client";

/**
 * THE BOARD HEADER'S OWN CONTROLS — the underline fields (Description, and the
 * Rename face of the name) and the gear menu (2026-09-10, Samuel's restyle of
 * this header). ⚠ They live beside `ontology-view.tsx` rather than in it for the
 * 500-line cap, and nowhere else mounts them: this is the ontology board's
 * header, on both surfaces.
 */

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import { MenuDivider, MenuItem, Popover } from "@/shared/ui/popover-menu";

/**
 * THE HEADER'S UNDERLINE FIELD — **ONE RECIPE, TWO FIELDS** (`DescriptionField`
 * and `NameField` below). Samuel, 2026-09-10: *"a gray underline that turns black
 * when a user is editing (like the one we have in other places)"*.
 *
 * ⚠ **THE RECIPE IS `shared/ui/form-dialog.module.css`'s, BY IMPORT** — the popup
 * kit's `UnderlineField` face, which is the "one we have in other places": a 2px
 * `--border-strong` rule at rest with the black `::after` sweeping in from the
 * left while focused. Nothing is hand-drawn here, and nothing is re-cut per
 * field: a second copy of this wrapper is how the two lines in one header come to
 * differ by a pixel. ⚠ And it is not `UnderlineField` itself: that component
 * brings a bold LABEL above the control (`FormSection`), and these fields' names
 * are their HINT, inside the line.
 *
 * ⚠ THE ACTIVE CLASS IS REACT STATE, NOT `:focus-within` — the module's own rule
 * for its own reason: jsdom loads no stylesheet, so a pure-CSS focus rule reports
 * the same nothing whether it is there or not.
 */
export function InlineUnderlineField({
  label,
  value,
  onChange,
  className,
  inputClassName,
  autoFocus,
  onKeyDown,
  onBlur,
}: {
  /** The hint inside the line, and the accessible name. */
  label: string;
  /** Extra class on the input itself (the kit's `.inputAction` for a 36px row). */
  inputClassName?: string;
  value: string;
  onChange: (next: string) => void;
  /** Width/flex only — the face is this component's. */
  className?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  /** Fired AFTER the active class clears, so a commit may unmount the field. */
  onBlur?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <span
      className={cn(
        fieldStyles.line,
        focused && fieldStyles.lineActive,
        "min-w-0",
        className
      )}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={label}
        spellCheck={false}
        className={cn(fieldStyles.input, inputClassName)}
      />
    </span>
  );
}

/**
 * THE ONTOLOGY'S DESCRIPTION — the shared field, hinted "Description". It
 * replaced a bare input whose placeholder was a sentence.
 *
 * ⚠ SAME SAVE PATH AS THE INPUT IT REPLACED — `CLUSTER_UPDATE` at `purpose`,
 * debounced by the store. The word "purpose" is still what agents read.
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
      className="flex-1"
      // ⚠ AS TALL AS THE BLACK BUTTON beside it, so the hairline is flush with
      // that button's bottom edge (Samuel, 2026-09-10).
      inputClassName={fieldStyles.inputAction}
    />
  );
}

/**
 * THE ONTOLOGY'S NAME, WHILE IT IS BEING RENAMED — the same underline field, in
 * the slot the name dropdown's trigger normally occupies.
 *
 * ⚠ **RENAMING IS A MENU ACT NOW, NOT AN ALWAYS-ON INPUT.** The name became the
 * switcher's TRIGGER on 2026-09-10, which deleted the inline name input and with
 * it every way to rename an ontology from the board; the gear's "Rename" row is
 * the way back. So this field is mounted only while renaming, and the chevron is
 * gone with the trigger it belongs to rather than hidden separately.
 *
 * ⚠ **ENTER AND BLUR SAVE, ESCAPE CANCELS, EMPTY CANCELS.** An empty name is not
 * a rename to "" — the switcher's trigger would then read "Untitled" with no way
 * to tell an unnamed ontology from a slipped keystroke. There is no blur-after-
 * Escape double-fire to guard: the host unmounts this field, and React fires no
 * `blur` on an unmounted input (`skills/components/skill-folder-control.tsx` is
 * the same shape).
 */
export function NameField({
  name,
  onCommit,
  onCancel,
}: {
  name: string;
  /** The existing `CLUSTER_UPDATE.name` path — never called with "". */
  onCommit: (next: string) => void;
  /** Leave the rename face untouched (Escape, empty, or no change). */
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
 * THE BOARD'S GEAR — one round 36px trigger over every menu row this header has
 * (Samuel, 2026-09-10: *"change the … button to the left of it, to be a circle
 * and to have a settings icon"*). It was `…`, a 28px rounded rectangle the HOST
 * rendered through a `headerEnd` slot.
 *
 * ⚠ **ONE TRIGGER, TWO SOURCES OF ROWS.** Rename and "+ Column" are the VIEW's —
 * the header button that used to carry column creation now says "+ Object", and
 * the name is a dropdown trigger rather than an input, so both acts live here.
 * Everything under the divider is the HOST's: /home's Share, Changelog and agents
 * rungs.
 *
 * ⚠ **DELETE IS ONE SLOT, AND IT IS THE LAST ROW.** The workspace page had a
 * standalone `Trash2` button beside this gear until 2026-09-10; it is DELETED and
 * its confirm is now `onDelete` here. A host that brings its own Delete (/home's
 * names the CHANNELS the ontology is lent into — Q4 — which the board cannot
 * know) passes it in `hostRows` and no `onDelete`, so the menu shows exactly one
 * Delete on either surface, never two.
 *
 * ⚠ COORDINATE MODE, like the switcher beside it and for the same reason: this
 * menu opens inside `.page-float`, an overflow-clipping pane where a
 * trigger-anchored panel renders as a clipped sliver.
 */
export function BoardSettingsMenu({
  clusterName,
  onRename,
  onAddColumn,
  hostRows,
  onDelete,
}: {
  clusterName: string;
  /** Member+ only — a viewer gets the host's rows and no edits. */
  onRename?: () => void;
  onAddColumn?: () => void;
  hostRows?: (close: () => void) => ReactNode;
  /** ⚠ Omit when `hostRows` supplies Delete. */
  onDelete?: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = () => setAnchor(null);
  const boardRows = Boolean(onRename || onAddColumn);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title="Ontology settings"
        aria-label={`Settings for ${clusterName || "ontology"}`}
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
        className="btn-light flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-primary"
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
        {onAddColumn && (
          <MenuItem
            icon={<Plus size={12} />}
            onSelect={() => {
              close();
              onAddColumn();
            }}
          >
            Column
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
