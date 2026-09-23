"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
// Deep import, never the `settings-modal` barrel: it reaches `next/navigation`, and any `next/*`
// module in the import graph fails the desktop SPA build.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { cn } from "@/shared/lib/utils";
import { SECTION_HEADING_TEXT } from "./section-heading";

/**
 * The standard dialog: one width, one heading, one footer row; every dialog composes it.
 * Width is not a prop: always `size="narrow"` (`settings-modal.module.css › .cardNarrow`).
 * Heading casing is CSS, never the string: `title` is also the accessible name that screen
 * readers say and `getByRole("dialog", { name })` matches.
 */

/** The dialog heading. `px-9` on both sides: the close X is absolutely positioned at the right,
 *  so one-sided padding would centre the text off the box. */
export const DIALOG_TITLE =
  // The section heading type in Title Case; `capitalize` does it, so callers write "New agent".
  cn("px-9 text-center capitalize", SECTION_HEADING_TEXT);

/**
 * The same heading with casing left alone, for a title that interpolates a name somebody typed
 * (`titleCase={false}`): `capitalize` would render "iPhone leads" as "IPhone Leads".
 */
export const DIALOG_TITLE_AS_TYPED = cn(
  "px-9 text-center",
  SECTION_HEADING_TEXT
);

/** Shared geometry of the footer pair: fully rounded on every standard dialog. */
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
  titleCase = true,
  closeLabel = "Close",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Visible heading and the dialog's accessible name. */
  title: string;
  /** `false` for a title that carries a name the operator typed ({@link DIALOG_TITLE_AS_TYPED}). */
  titleCase?: boolean;
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
      {/* The body owns the scroll, not `.cardNarrow`. */}
      <div className="flex max-h-[76vh] flex-col gap-4 overflow-y-auto p-6">
        <h2 className={titleCase ? DIALOG_TITLE : DIALOG_TITLE_AS_TYPED}>
          {title}
        </h2>
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
  /** A word or two, never a sentence (INVARIANTS §5). */
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

/** The footer row: `children` at the right (Cancel, then the verb); `leading` is the left-hand
 *  slot a destructive verb takes. */
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
