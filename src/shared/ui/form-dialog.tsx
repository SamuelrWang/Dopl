"use client";

/**
 * The popup form kit: every dialog that collects input is a `FormDialog` (a yes/no question stays
 * `confirm-dialog.tsx › ConfirmDialog`). Anatomy: `StandardDialog`, stacked {@link FormSection}s
 * (label above control), {@link UnderlineField} for text ({@link InlineUnderlineField} when it has
 * no label), {@link PillChoice} for a single choice, and a footer of text Discard + `auth-btn-3d` verb.
 * Everything inside a popup is the 30px `--action-h-sm` scale; 36px belongs to the page buttons
 * that open one (`channels/components/bits.tsx › TAB_ACTION`).
 * Escape, the backdrop and × are Discard, so {@link FormDialog} takes one exit, not two.
 * Conformance table: docs/DESIGN-SYSTEM.md, "Popup forms".
 */

import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { DialogActions, StandardDialog } from "./standard-dialog";
import { SegmentedControl } from "./segmented-control";
import { cn } from "@/shared/lib/utils";
import { SMALL_PRIMARY_BUTTON, SMALL_TEXT_BUTTON } from "./small-action-button";
import styles from "./form-dialog.module.css";

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
 * The LABEL-LESS underline field: {@link UnderlineField}'s line and sweep with no label above it —
 * the name is the hint inside the line. Born as the ontology board header's fields (Samuel,
 * 2026-09-10: gray rule that turns black while editing) and moved into the kit on 2026-09-28 when
 * the profile popup's inline fields (the pairing code) took the underline — one recipe, not two.
 *
 * The active class is React state, not `:focus-within`: jsdom loads no stylesheet,
 * so a pure-CSS focus rule would be untestable.
 */
export function InlineUnderlineField({
  label,
  placeholder = label,
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
  /** The hint, when the row already SAYS the label beside the line (the pairing code). */
  placeholder?: string;
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
        styles.line,
        focused && styles.lineActive,
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
        placeholder={placeholder}
        spellCheck={false}
        className={cn(styles.input, quiet && styles.inputQuiet, inputClassName)}
      />
    </span>
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
          className={cn(SMALL_PRIMARY_BUTTON, primary.disabled && "cursor-not-allowed opacity-60")}
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
