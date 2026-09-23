"use client";

/**
 * The popup form kit: every dialog that collects input is a `FormDialog` (a yes/no question stays
 * `confirm-dialog.tsx › ConfirmDialog`). Anatomy: `StandardDialog`, stacked {@link FormSection}s
 * (label above control), {@link UnderlineField} for text, {@link PillChoice} for a single choice,
 * and a footer of text Discard + `auth-btn-3d` verb.
 * Everything inside a popup is the 30px `--action-h-sm` scale; 36px belongs to the page buttons
 * that open one (`channels/components/bits.tsx › TAB_ACTION`).
 * Escape, the backdrop and × are Discard, so {@link FormDialog} takes one exit, not two.
 * Conformance table: docs/DESIGN-SYSTEM.md, "Popup forms".
 */

import { useState, type ReactNode } from "react";
import { DialogActions, StandardDialog } from "./standard-dialog";
import { SegmentedControl } from "./segmented-control";
import { cn } from "@/shared/lib/utils";
import { SMALL_TEXT_BUTTON } from "./small-action-button";
import styles from "./form-dialog.module.css";

/** The verb — the composer's black CTA face, at `--action-h-sm`. */
const PRIMARY_BTN =
  "auth-btn-3d flex h-[var(--action-h-sm)] items-center rounded-[8px] px-3.5 text-caption " +
  "font-semibold text-text-on-cta";

/**
 * One section: the bold label, then the control under it. The weight lives in the module's
 * `.label`, never per caller (pinned by `launch-agent-dialog.test.tsx`). `htmlFor` makes it a
 * `<label>`; without one it is a `<span>`, since a `<label>` around a pill row would click the
 * first option.
 */
export function FormSection({
  label,
  htmlFor,
  caption,
  children,
}: {
  label: string;
  /** The control's id, for a text field. Absent ⇒ the label is a plain span. */
  htmlFor?: string;
  /** A word or two, never longer than one line (INVARIANTS §5). */
  caption?: string;
  children: ReactNode;
}) {
  const text = (
    <>
      {label}
      {caption && <span className={styles.caption}>{caption}</span>}
    </>
  );
  return (
    <div className={styles.row}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={styles.label}>
          {text}
        </label>
      ) : (
        <span className={styles.label}>{text}</span>
      )}
      {children}
    </div>
  );
}

/**
 * One text field: the label, then the line. The active class is React state, not
 * `:focus-within`, because jsdom loads no stylesheet; `.lineActive` is the contract suites match
 * on. `multiline` swaps the element only, so Enter breaks the line and does not submit.
 */
export function UnderlineField({
  label,
  value,
  onChange,
  ariaLabel,
  id,
  caption,
  multiline = false,
  minRows = 1,
  maxLength,
  onEnter,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  id: string;
  caption?: string;
  multiline?: boolean;
  /** Starting height in lines for a `multiline` field; it grows with the text. */
  minRows?: number;
  /** The server's own ceiling, felt at the keyboard. It mirrors a zod `.max()`, so a caller that
   *  passes one names the schema it copies. */
  maxLength?: number;
  /**
   * Enter submits, for a single-line field with one obvious verb; ignored when `multiline`.
   * The caller's handler must re-check its own guard (a keystroke can fire a disabled-looking
   * verb). IME-guarded: a CJK operator's Enter commits a candidate and must not raise a write.
   */
  onEnter?: () => void;
  /** The field the caret lands in. At most one per dialog: `StandardDialog` manages no focus,
   *  so two would race. */
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const shared = {
    id,
    value,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    spellCheck: false,
    maxLength,
    autoFocus,
    "aria-label": ariaLabel,
  };
  return (
    <FormSection label={label} htmlFor={id} caption={caption}>
      <span className={cn(styles.line, focused && styles.lineActive)}>
        {multiline ? (
          <textarea {...shared} rows={minRows} className={cn(styles.input, styles.inputMultiline)} />
        ) : (
          <input
            {...shared}
            type="text"
            onKeyDown={
              onEnter
                ? (event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing)
                      return;
                    event.preventDefault();
                    onEnter();
                  }
                : undefined
            }
            className={styles.input}
          />
        )}
      </span>
    </FormSection>
  );
}

/**
 * One single-choice row: 30px borderless pills under a bold label. `plain` + `md` are fixed here
 * so a popup form cannot reach another face. `flex-wrap` is the consumer's, since a roster has no
 * width budget this file can promise. `ariaLabel` is required: the visible label is not attached
 * to the `role="tablist"`.
 */
export function PillChoice<K extends string>({
  label,
  options,
  value,
  onChange,
  ariaLabel,
  caption,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ key: K; label: string; hint?: string }>;
  value: K;
  onChange: (next: K) => void;
  ariaLabel: string;
  caption?: string;
  /** Layout only — `"flex-wrap"` where the roster is unbounded. */
  className?: string;
}) {
  return (
    <FormSection label={label} caption={caption}>
      <SegmentedControl
        options={options}
        value={value}
        onChange={onChange}
        variant="plain"
        size="md"
        className={className}
        ariaLabel={ariaLabel}
      />
    </FormSection>
  );
}

/** The footer's verb. `busy` disables without dimming; `disabled` does both (in flight is not
 *  unavailable). */
export interface FormDialogPrimary {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** A disabled submit says why (INVARIANTS §8): the `title`, one short sentence. */
  hint?: string;
}

/** The shell. One exit: `onDiscard` is the ×, the backdrop, Escape and the Discard button. */
export function FormDialog({
  open,
  onDiscard,
  title,
  titleCase,
  closeLabel,
  discardLabel = "Discard",
  primary,
  children,
}: {
  open: boolean;
  onDiscard: () => void;
  /** Visible heading and the dialog's accessible name. */
  title: string;
  /** `false` when the title interpolates a name the operator typed: CSS `capitalize` would
   *  rewrite "iPhone leads" (`standard-dialog.tsx › DIALOG_TITLE_AS_TYPED`). */
  titleCase?: boolean;
  /** Accessible name for the ×, where a surface has more than one open dialog. */
  closeLabel?: string;
  discardLabel?: string;
  primary: FormDialogPrimary;
  children: ReactNode;
}) {
  return (
    <StandardDialog
      open={open}
      onClose={onDiscard}
      title={title}
      titleCase={titleCase}
      closeLabel={closeLabel}
    >
      {children}
      <DialogActions>
        <button type="button" className={SMALL_TEXT_BUTTON} onClick={onDiscard}>
          {discardLabel}
        </button>
        <button
          type="button"
          className={cn(PRIMARY_BTN, primary.disabled && "cursor-not-allowed opacity-60")}
          onClick={primary.onClick}
          disabled={primary.disabled || primary.busy}
          title={primary.hint}
        >
          {primary.label}
        </button>
      </DialogActions>
    </StandardDialog>
  );
}
