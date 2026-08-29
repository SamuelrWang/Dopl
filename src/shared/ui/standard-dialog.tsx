"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
// ⚠ Deep import, NEVER the `settings-modal` barrel: the barrel re-exports
// SettingsModal, whose section tree reaches `next/navigation`, and any `next/*`
// module in the import graph fails the desktop SPA build. Every dialog in this
// tree states this rule; stating it ONCE here is half the point of the file.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { cn } from "@/shared/lib/utils";

/**
 * THE STANDARD DIALOG — one width, one heading, one footer row (Samuel's
 * ruling, 2026-08-27).
 *
 * The agent-template editor was the reference: `ModalShell size="narrow"`, a
 * scrolling `p-6` body, `RAISED_INPUT` text controls and uppercase field
 * headers. Four dialogs wore four near-copies of that recipe — New agent, New
 * knowledge base, Add person (a POPOVER at the time) and New channel — so the
 * recipe is stated HERE and each dialog composes it.
 *
 * ⚠ WIDTH IS NOT A PROP. Every standard dialog is `size="narrow"`
 * (`settings-modal.module.css › .cardNarrow`, `min(92vw, 640px)`). A dialog
 * that needed its own width would be the fifth near-copy this file exists to
 * delete; take the width to the CSS module or take the surface out of the set.
 *
 * ⚠ THE HEADING IS CENTERED AND UPPERCASED IN CSS, NOT IN THE STRING. `title`
 * is the dialog's accessible name (`ModalShell`'s `aria-label`) as well as its
 * visible text, and a `.toUpperCase()` here would rewrite what a screen reader
 * says and what every `getByRole("dialog", { name })` in the suites matches.
 */

/** THE dialog heading. `px-9` on BOTH sides: the close X is absolutely
 *  positioned at the right, so one-sided padding would centre the text against
 *  a box the glyph is sitting outside of. */
export const DIALOG_TITLE =
  "px-9 text-center text-title font-semibold uppercase tracking-wide text-text-primary";

/** Shared geometry of the footer pair. FULLY ROUNDED (Samuel, 2026-08-27) —
 *  both buttons, on every standard dialog, no square-cornered exception. */
const DIALOG_BTN = "h-10 rounded-full px-4 text-body font-medium";

/** The footer's left-hand button (Cancel) — the kit's white raised face. */
export const DIALOG_BTN_SECONDARY = cn(
  "auth-btn-3d-light",
  DIALOG_BTN,
  "text-text-primary"
);

/** The footer's right-hand button (the verb) — the kit's black raised CTA. */
export const DIALOG_BTN_PRIMARY = cn(
  "auth-btn-3d",
  DIALOG_BTN,
  "text-white disabled:opacity-40"
);

export function StandardDialog({
  open,
  onClose,
  title,
  closeLabel = "Close",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Visible heading AND the dialog's accessible name — see the docblock. */
  title: string;
  /** Accessible name for the X, where a page has more than one open dialog. */
  closeLabel?: string;
  children: ReactNode;
}) {
  return (
    <ModalShell open={open} onClose={onClose} label={title} size="narrow">
      <button
        type="button"
        className={modalStyles.close}
        onClick={onClose}
        aria-label={closeLabel}
      >
        <X size={18} />
      </button>
      {/* ⚠ The body owns the scroll, not `.cardNarrow`: the heading and the
          footer must not scroll away from a long form. */}
      <div className="flex max-h-[76vh] flex-col gap-4 overflow-y-auto p-6">
        <h2 className={DIALOG_TITLE}>{title}</h2>
        {children}
      </div>
    </ModalShell>
  );
}

export function DialogField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** ⚠ A WORD OR TWO, never a sentence (INVARIANTS §5, minimal copy). */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-label font-semibold uppercase tracking-wide text-text-secondary"
      >
        {label}
        {hint && (
          <span className="ml-1 font-normal normal-case text-text-muted">{hint}</span>
        )}
      </label>
      {children}
    </div>
  );
}

/**
 * The footer row. `children` sit at the RIGHT (Cancel, then the verb);
 * `leading` is the left-hand slot a destructive verb takes — the spacer
 * between them is the layout, so a dialog without a Delete does not have to
 * remember to render one.
 */
export function DialogActions({
  leading,
  children,
}: {
  leading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      {leading}
      <span className="flex-1" />
      {children}
    </div>
  );
}
