"use client";

/**
 * THE POPUP FORM KIT — the recipe Samuel approved on the New agent popup, stated ONCE so the
 * next dialog composes it instead of copying it (2026-09-08).
 *
 * His words, verbatim, because this file exists for them: *"i want to make a pop up for the
 * threads creation as well. And put in the new agent button in the agents tab. Also, what other
 * buttons result in a pop up? Because i want to start conforming all pop ups to the UI of the one
 * we just made, we should make a design system for this."*
 *
 * ⚠ IT IS AN EXTRACTION, NOT A NEW FACE. Every rule below was
 * `channels/components/launch-agent-dialog.tsx` an hour ago and moved unchanged — the CSS module came
 * with it, verbatim, exactly as its own docblock said it would when the experiment was ruled in.
 * `launch-agent-dialog.test.tsx` passes with no edit, and that is the proof the move cost nothing.
 *
 * THE ANATOMY, top to bottom:
 *   1. `StandardDialog` — one width, the uppercase title top-left of a close ×.
 *   2. {@link FormSection}s, stacked — a SEMI-BOLD label ABOVE its control, never beside it.
 *   3. text entry is {@link UnderlineField}: no box, a 1px `--border-strong` rule at rest, a 2px
 *      ink line sweeping in from the left on focus (reduced motion keeps the state, drops the
 *      sweep).
 *   4. a single choice is {@link PillChoice}: `SegmentedControl variant="plain" size="md"` —
 *      30px, regular weight, gray fill, no hairline, one option preselected.
 *   5. the footer: a text Discard on the left of the pair, the `auth-btn-3d` verb on the right,
 *      both `--action-h-sm` and `rounded-[8px]`.
 *
 * ⚠ THE TWO SCALES ARE NOT INTERCHANGEABLE. Everything INSIDE a popup form is the 30px
 * small-action scale (`--action-h-sm`); the 36px scale belongs to the PAGE buttons that open one
 * (`channels/components/bits.tsx › TAB_ACTION`, the Agents tab's New agent). A dialog cut to 36px is the
 * drift this file exists to stop.
 *
 * ⚠ ESCAPE AND THE BACKDROP **ARE** DISCARD, so {@link FormDialog} takes ONE exit and not two.
 * A dialog whose × kept a half-typed draft the operator dismissed would be remembering a decision
 * they undid — and a second callback is how the × and the button come to disagree.
 *
 * ⚠ EVERY DIALOG THAT COLLECTS INPUT IS A `FormDialog`. A dialog that only asks a yes/no question
 * stays `shared/ui/confirm-dialog.tsx › ConfirmDialog` — it has no fields, so it has nothing this
 * kit gives it. The live conformance table is docs/DESIGN-SYSTEM.md's "Popup forms" section.
 */

import { useState, type ReactNode } from "react";
import { DialogActions, StandardDialog } from "./standard-dialog";
import { SegmentedControl } from "./segmented-control";
import { cn } from "@/shared/lib/utils";
// Discard is `SMALL_TEXT_BUTTON` — the composer's own text-button face, one declaration.
import { SMALL_TEXT_BUTTON } from "./small-action-button";
import styles from "./form-dialog.module.css";

/** The verb — the composer's black CTA face, at `--action-h-sm`. */
const PRIMARY_BTN =
  "auth-btn-3d flex h-[var(--action-h-sm)] items-center rounded-[8px] px-3.5 text-caption " +
  "font-semibold text-text-on-cta";

/**
 * ONE SECTION — the bold label, then the control under it.
 *
 * ⚠ THE WEIGHT LIVES IN THE MODULE, NOT PER CALLER (Samuel, 2026-09-08: *"All of the headers
 * (name, description, template, etc), should be bolded"*). Every label on every popup form is
 * `.label` and nothing else, which is what `launch-agent-dialog.test.tsx` pins by asserting that
 * the four labels share ONE class string and that none carries a `font-*` utility.
 * ⚠ `htmlFor` MAKES IT A `<label>`; without one it is a `<span>`, because a `<label>` wrapping a
 * pill row would make the word itself click the first option.
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
  /** ⚠ A WORD OR TWO, NEVER LONGER THAN ONE LINE (INVARIANTS §5, minimal copy). */
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
 * ONE TEXT FIELD — the label, then the line.
 *
 * ⚠ THE ACTIVE CLASS IS REACT STATE, NOT `:focus-within`, and the module states why: jsdom loads
 * no stylesheet, so a pure-CSS focus rule cannot be pinned on a rendered tree. The animation is
 * the CSS module's either way, and `.lineActive` is the CONTRACT the suites match on.
 * ⚠ `multiline` SWAPS THE ELEMENT AND NOTHING ELSE — same label, same line, same sweep. Enter
 * therefore breaks the line and does not submit, which is the rule the composer's own body field
 * has carried since 2026-08-26.
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
  /** Starting height in lines for a `multiline` field (Samuel, 2026-09-08: instructions
   *  "shouldn't be a one line default"). Grows past it with the text; 1 = as tall as a
   *  one-line field. */
  minRows?: number;
  /**
   * The SERVER'S OWN CEILING, felt at the keyboard rather than as a 400 after the fact.
   * ⚠ ADDITIVE AND OPTIONAL (2026-09-15): every existing caller omits it and is unchanged.
   * ⚠ It is a MIRROR of a zod `.max()`, so a caller that passes one owes a comment naming
   * the schema it copies — a cap only this file knows is a cap that silently drifts.
   */
  maxLength?: number;
  /**
   * ENTER SUBMITS — for a SINGLE-LINE field whose dialog has one obvious verb.
   * ⚠ IGNORED WHEN `multiline`, and that is the kit's standing rule rather than this
   * prop's caution: Enter breaks the line in a body field and only the verb raises the
   * write (the composer's rule since 2026-08-26, restated in {@link UnderlineField}'s
   * own docblock). Wiring it on both would make one popup disagree with the others.
   * ⚠ The caller's handler must re-check its own guard — a disabled-looking button a
   * keystroke can still fire is the bug this shape invites.
   */
  onEnter?: () => void;
  /**
   * THE FIELD THE CARET LANDS IN. ⚠ At most ONE per dialog — `StandardDialog` does no
   * focus management of its own, so two would race and the loser's field would look
   * focused to nobody. Additive and default-`false`: every existing caller opens with
   * no field focused, exactly as it did.
   */
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
                    if (event.key !== "Enter") return;
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
 * ONE SINGLE-CHOICE ROW — 30px borderless pills under a bold label.
 *
 * ⚠ `plain` + `md` ARE THE RULING, IN TWO WORDS: gray fill with no hairline, at `--action-h-sm`.
 * Both live on the shared primitive, and this wrapper FIXES them so a popup form cannot reach a
 * fifth face by passing a different pair.
 * ⚠ `flex-wrap` IS THE CONSUMER'S, deliberately: a template roster has no width budget this file
 * can promise, and a row that wrapped by default would silently reshape a two-option choice.
 * ⚠ `ariaLabel` IS REQUIRED — the visible word above the row is not attached to the `role=
 * "tablist"`, so without it a screen-reader operator gets an unnamed group.
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

/** The footer's right-hand verb. `busy` disables WITHOUT dimming; `disabled` does both, because
 *  a control that is merely in flight has not become unavailable. */
export interface FormDialogPrimary {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** ⚠ A DISABLED SUBMIT SAYS WHY (INVARIANTS §8, rule 4) — the `title`, one short sentence. */
  hint?: string;
}

/**
 * THE SHELL — title, close ×, the stacked sections, the footer pair.
 *
 * ⚠ ONE EXIT, NOT TWO: `onDiscard` is the ×, the backdrop, Escape AND the Discard button. See
 * the header.
 */
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
  /** Visible heading AND the dialog's accessible name (`StandardDialog`'s own rule). */
  title: string;
  /** ⚠ `false` when the title interpolates a name the operator typed — CSS
   *  `capitalize` would rewrite "iPhone leads" to "IPhone Leads"
   *  (`standard-dialog.tsx › DIALOG_TITLE_AS_TYPED`). */
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
