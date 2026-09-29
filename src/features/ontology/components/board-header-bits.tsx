"use client";

/**
 * The ontology board header's own controls: the underline fields (Description and
 * the Rename face of the name) and the gear menu. They sit beside
 * `ontology-view.tsx` for the 500-line cap; nothing else mounts them.
 */

import {
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pencil, Settings, Trash2 } from "lucide-react";
import { InlineUnderlineField } from "@/shared/ui/form-dialog";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import { MenuDivider, MenuItem, Popover } from "@/shared/ui/popover-menu";

/** The label-less underline field lives in the popup form kit now (2026-09-28); re-exported for
 *  the ontology callers that import it from here. */
export { InlineUnderlineField };

/**
 * The ontology's description, hinted "Description". Saves through `ONTOLOGY_UPDATE`
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
  /** The existing `ONTOLOGY_UPDATE.name` path — never called with "". */
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
