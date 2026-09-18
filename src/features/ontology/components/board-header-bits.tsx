"use client";

/**
 * The ontology board header's own controls: the underline fields (Description and
 * the Rename face of the name) and the gear menu. They sit beside
 * `ontology-view.tsx` for the 500-line cap; nothing else mounts them.
 */

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Pencil, Settings, Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import { MenuDivider, MenuItem, Popover } from "@/shared/ui/popover-menu";

/**
 * One underline recipe for both header fields (Samuel, 2026-09-10: gray rule that
 * turns black while editing). The face is `shared/ui/form-dialog.module.css`'s by
 * import — never re-cut per field, or two lines in one header drift by a pixel.
 * Not `UnderlineField` itself: that draws a bold label above the control, and
 * these fields' names are their hint, inside the line.
 *
 * The active class is React state, not `:focus-within`: jsdom loads no stylesheet,
 * so a pure-CSS focus rule would be untestable.
 */
export function InlineUnderlineField({
  label,
  value,
  onChange,
  className,
  inputClassName,
  quiet,
  autoFocus,
  readOnly,
  onKeyDown,
  onBlur,
}: {
  /** The hint inside the line, and the accessible name. */
  label: string;
  /** Extra class on the input itself (the kit's `.inputAction` for a 36px row). */
  inputClassName?: string;
  /**
   * No rule at rest, black line only while focused (Samuel, 2026-09-14, over the
   * object panel's rows). The kit's `.inputQuiet` is a resting state of this same
   * recipe, not a second field, so only the gray goes transparent. Panel row fields
   * wear it; the two Description fields keep their gray→black line.
   */
  quiet?: boolean;
  value: string;
  onChange: (next: string) => void;
  /** Width/flex only — the face is this component's. */
  className?: string;
  autoFocus?: boolean;
  /**
   * Viewer parity (2026-09-12): the line keeps its face and still takes focus —
   * `disabled` would drop the row out of the tab order.
   */
  readOnly?: boolean;
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
        readOnly={readOnly}
        aria-label={label}
        placeholder={label}
        spellCheck={false}
        className={cn(fieldStyles.input, quiet && fieldStyles.inputQuiet, inputClassName)}
      />
    </span>
  );
}

/**
 * The ontology's description, hinted "Description". Saves through `CLUSTER_UPDATE`
 * at `purpose`, debounced by the store — "purpose" is still what agents read.
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
      // as tall as the black button beside it, so the hairline is flush with that
      // button's bottom edge (Samuel, 2026-09-10).
      inputClassName={fieldStyles.inputAction}
    />
  );
}

/**
 * The ontology's name while being renamed — the same underline field, in the slot
 * the switcher's trigger occupies. Renaming is a menu act (2026-09-10), so this is
 * mounted only while renaming.
 *
 * Enter and blur save; Escape and an empty name cancel — a rename to "" would read
 * as "Untitled" and hide a slipped keystroke. No blur-after-Escape double-fire to
 * guard: the host unmounts the field and React fires no `blur` on an unmounted
 * input (`skills/components/skill-folder-control.tsx` is the same shape).
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
 * The board's gear: one round 36px trigger over every menu row this header has
 * (Samuel, 2026-09-10).
 *
 * Two sources of rows — Rename is the view's; everything under the divider is the
 * host's (/home's Share, Changelog and agents rungs).
 *
 * 2026-09-11: no "+ Column" row — the header's black button makes the lane
 * (`ontology-view.tsx › handleNewObject`). One place per control.
 *
 * Delete is one slot and the last row. A host that brings its own Delete passes it
 * in `hostRows` and no `onDelete`, so exactly one Delete shows on either surface.
 *
 * Coordinate mode, like the switcher beside it: this menu opens inside
 * `.page-float`, where a trigger-anchored panel renders as a clipped sliver.
 */
export function BoardSettingsMenu({
  clusterName,
  onRename,
  hostRows,
  onDelete,
}: {
  clusterName: string;
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
