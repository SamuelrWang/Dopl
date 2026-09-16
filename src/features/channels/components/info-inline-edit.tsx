"use client";

/**
 * CLICK-TO-EDIT, ON A LINE THAT LOOKS LIKE TEXT (Samuel, 2026-09-16).
 *
 * ⚠ IT IS NOT THE UNDERLINE IDIOM, AND THE DIFFERENCE IS THE RULING RATHER THAN
 * a style. `info-card-rows.tsx › InfoCardCustomRow` edits a row the operator
 * ADDED, and `shared/ui/wells.ts › UNDERLINE_FIELD` marks it as a field so the
 * reader can see there is something to fill in. The channel's NAME and
 * DESCRIPTION are neither blank nor optional — they are the room's own label,
 * already on screen as a fact — so the line here carries **no underline, no
 * border, no box, no pencil and no hover fill**. The only thing that says it can
 * be edited is the CURSOR, and that is deliberate: the resting state must be
 * indistinguishable from the plain text beside it.
 *
 * ⚠ BLUR SAVES, IMMEDIATELY. Clicking off a line you typed into means "keep it"
 * everywhere else in this product (`info-card-rows.tsx`, `agent-rename.tsx`), so
 * there is no Save button and no confirm step. Enter saves and Escape cancels,
 * the same three keys those two files established.
 *
 * ⚠ THE FIELD INHERITS THE READ LINE'S TYPE AND FOOTPRINT. The row must not
 * change height or width between reading and editing, or every row under it
 * jumps the moment the cursor lands — which on a five-row panel reads as the
 * panel flinching.
 *
 * ⚠ AN UNCHANGED VALUE WRITES NOTHING. A click that only passed through a line
 * is not an edit, and firing the PATCH anyway would bump the channel's
 * `updated_at` — the channels list's sort key — and reorder somebody's sidebar
 * because they looked at a name.
 */

import { useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * THE INFO TAB'S HEADER-EDIT BUNDLE — one optional prop rather than four, so a
 * host that wires the write hands one object and a host that does not hands
 * nothing and gets the display face.
 *
 * ⚠ **`canEdit` IS THE PERMISSION *AND* THE DERIVED-NAME RULE, ALREADY RESOLVED
 * BY THE HOST** (`surface-info-panel.tsx`). The panel decides nothing about the
 * write; see the host for both halves.
 */
export interface ChannelHeaderEdit {
  canEdit: boolean;
  onSaveName: (name: string) => void;
  onSaveTopic: (topic: string) => void;
  /** A save is in flight — INK ONLY, see {@link InlineEditText.busy}. */
  busy: boolean;
}

export function InlineEditText({
  value,
  onCommit,
  editable = true,
  label,
  placeholder = "—",
  maxLength,
  className,
  emptyClassName,
  busy = false,
}: {
  /** The value as stored. ⚠ The read line shows `placeholder` when it is empty;
   *  the FIELD still opens on the empty string, never on the placeholder. */
  value: string;
  /** ⚠ Called with the TRIMMED value, and only when it actually changed. */
  onCommit: (next: string) => void;
  /**
   * `false` renders the plain text with no cursor change and no click target —
   * the non-manager's face, and the DM's. The server gates `name` / `topic` on
   * manage (`service-writes-channel.ts › MANAGED_CHANNEL_FIELDS`); this only
   * decides whether a reader is shown an affordance that would end in a 403
   * (INVARIANTS §5).
   */
  editable?: boolean;
  /** Accessible name for the field and the button — the row's own label. */
  label: string;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  /** Ink for the PLACEHOLDER face only, so an empty row can stay muted while a
   *  filled one is not. */
  emptyClassName?: string;
  /** A save is in flight. ⚠ INK ONLY — it never blocks a second edit, because
   *  the optimistic patch has already repainted the line. */
  busy?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // ⚠ Guards the double-commit: Enter blurs the field, and the blur handler
  // would otherwise send the same value a second time (`info-card-rows.tsx`).
  const settled = useRef(false);

  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const next = draft.trim();
    // ⚠ SEE THE DOCBLOCK: no write for a value that did not move.
    if (next !== value) onCommit(next);
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label={label}
        maxLength={maxLength}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
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
        // ⚠ EVERY CHROME OFF: no ring, no border, no fill, no padding of its own.
        // `w-full` so the caret has the whole band the read line occupied.
        className={cn(
          "w-full min-w-0 border-0 bg-transparent p-0 text-body text-text-primary outline-none focus:outline-none focus:ring-0",
          className
        )}
      />
    );
  }

  const face = value === "" ? placeholder : value;
  const ink = value === "" ? emptyClassName : undefined;

  if (!editable) {
    return (
      <span className={cn("min-w-0 truncate text-body text-text-primary", ink, className)}>
        {face}
      </span>
    );
  }

  return (
    // ⚠ A BUTTON, not a div with an onClick — the line is the edit target and
    // the keyboard must reach it. `cursor-text` because what a click starts is
    // TYPING, not a command; `text-left` and the read line's own type so it
    // renders byte-identically to the `editable: false` face above.
    <button
      type="button"
      aria-label={`Edit ${label}`}
      onClick={() => {
        settled.current = false;
        setDraft(value);
        setEditing(true);
      }}
      className={cn(
        "min-w-0 cursor-text truncate p-0 text-left text-body text-text-primary outline-none focus-visible:underline",
        busy && "opacity-60",
        ink,
        className
      )}
    >
      {face}
    </button>
  );
}
