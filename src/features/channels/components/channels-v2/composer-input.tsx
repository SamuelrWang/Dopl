"use client";

/**
 * THE COMPOSER INPUT ROW — the pill holding the text field and the send arrow, and the ONLY
 * place either composer builds one (Samuel, 2026-08-27).
 *
 * ⚠ IT IS A COMPONENT BECAUSE CONSTANTS WERE NOT ENOUGH, and that failure is the reason this
 * file exists in this shape. The two composers shared class constants for the border and the
 * padding and STILL rendered differently side by side: the surfaces are different TREES — the
 * channel composer is a multi-row card with a toolbar, the agent composer a single-row pill — so
 * the same classes landed at different nesting levels, the send button sat in two different flex
 * contexts, and a `gap` meant for one axis added height on the other. **Two hand-built trees
 * cannot be equalised by handing them the same strings.** One component renders one tree.
 *
 * ⚠ IT OWNS ALL OF IT: the ring, the radius, the padding, the gap, the field's type and height,
 * and the send button's size, colour and alignment. Nothing here is overridable per mount — there
 * is no `className`, no `size`, no `variant`. A prop that let one caller nudge the face would
 * re-open the exact gap this closes.
 *
 * ⚠ THE ONE THING A CALLER CHOOSES IS THE `face`, AND IT IS A MODE, NOT A STYLE HOOK (Samuel,
 * 2026-08-27). `"pill"` draws `.raised-tab`; `"bare"` draws no face at all. The agent composer is
 * NOTHING BUT this row, so there the pill IS the box. The channel composer already has a box —
 * its card — and a faced row inside a bordered card is a bubble in a bubble, which is the thing
 * being fixed.
 *
 * ⚠ THE INSET RIDES WITH THE FACE, AND ONLY WITH IT (Samuel, live review 2026-08-28). It used to
 * be unconditional and that was wrong in `"bare"`: the padding exists to hold content off a BOX'S
 * EDGE, and in bare mode there is no box here — the CARD is the box and the card already pays that
 * inset once (`composer.tsx`, `px-[13px] py-[11px]`). Paying it twice pushed the field 12px right
 * of and 6px below the toolbar icons directly under it, which is what Samuel was pointing at.
 * **So {@link PILL_FACE} carries the face AND the inset together** — one box, one inset — while
 * {@link ROW_GEOMETRY} (the axis, the alignment, the gap) and the FIELD's own recipe stay
 * unconditional, which is what keeps the two surfaces one row and not two trees.
 *
 * ⚠ THE FACE IS `.raised-tab`, THE APP-WIDE RAISED IDIOM (docs/DESIGN-SYSTEM.md), which draws its
 * own 1px ring from `--raised-light-line`. That ring IS the border both surfaces now wear — in
 * main it is worn by the CARD, which mounts THIS SAME class, the whole raised material and not an
 * extracted layer of it.
 * ⚠ `.raised-tab` SUPPLIES THE FILL, so no `bg-*` utility may ride along: the utility layer
 * outranks the kit layer and a stray background flattens the gradient to nothing.
 *
 * ⚠ THE SEND BUTTON IS `shared/ui/send-button.tsx` WITH NO PER-MOUNT PROPS beyond its wiring —
 * one size, one colour, one alignment, from one place. The channel composer used to pass it an
 * `ml-1` and an opacity of its own, which is how the two mounts came to look different.
 *
 * ⚠ WHERE THE ARROW SITS IS THE ONE THING THE TWO SURFACES NOW DISAGREE ON (Samuel, live review
 * 2026-08-28: the main card's send moves to the BOTTOM-RIGHT, level with the icon toolbar). The
 * agent bar is a single row, so its arrow stays inside it; main's card has a second row, and the
 * arrow belongs at the end of THAT one. **The button is still built in exactly one place** —
 * {@link ComposerSend} — so main lifts the SLOT, never the face: `composer.tsx` names no
 * `<SendButton>`, no size, no colour and no alignment of its own, which is the property that broke
 * the last three times and the one `composer-input.test.ts` pins.
 */

import type { KeyboardEvent, RefObject } from "react";
import { cn } from "@/shared/lib/utils";
import { SendButton } from "@/shared/ui/send-button";

/**
 * HOW FAR EITHER COMPOSER SITS OFF THE BOTTOM OF ITS COLUMN — one value, both surfaces.
 *
 * ⚠ THE TWO BOXES SIT SIDE BY SIDE ACROSS THE PANE DIVIDER (the agent panel is `inset-y-0`
 * against the same bottom edge the message pane ends on), so any difference here reads as one
 * composer floating higher than the other — it did, by the 4px between the channel composer's
 * `pb-4` and the agent composer's `py-3` (Samuel, live review 2026-08-27).
 * ⚠ IT IS THE BOTTOM ONLY. Each surface keeps its own TOP spacing, which answers a different
 * question (what sits above it — a transcript, or a work stream) and is not what aligns.
 */
export const COMPOSER_BOTTOM = "pb-4";

/**
 * THE AXIS, THE ALIGNMENT AND THE GAP — one string, handed to BOTH modes unconditionally.
 *
 * ⚠ NOTHING ABOUT A BOX IS IN HERE ANY MORE (2026-08-28). The radius and the padding moved to
 * {@link PILL_FACE}, where they belong: they describe an EDGE, and only one mode draws one. What
 * is left is the row's shape as a row, and it may never take a `face` branch — the moment the
 * two modes lay out differently they are two trees again, which is the failure the header
 * describes.
 * ⚠ `items-center` IS WHAT ALIGNS THE ARROW to the field wherever the arrow is.
 */
const ROW_GEOMETRY = "flex items-center gap-2";

/**
 * THE BOX: the raised material and the inset that holds content off its edge, together.
 *
 * ⚠ THEY ARE ONE THING AND MUST STAY ONE THING. The inset is not a style preference, it is what a
 * drawn edge costs; splitting them is how `"bare"` came to pay for an edge it does not draw. In
 * main the CARD is the box and the CARD pays it — see the header.
 */
const PILL_FACE = "raised-tab rounded-[10px] p-1.5 pl-3";

/** THE ARROW'S WIRING — what it does, never how it looks. */
export type ComposerSendWiring = {
  onSend: () => void;
  sendDisabled: boolean;
  /** ⚠ A DISABLED SEND SAYS WHY (INVARIANTS §8, rule 4). */
  sendTitle: string;
  sendLabel: string;
};

/**
 * THE ARROW, AND THE ONLY PLACE EITHER COMPOSER GETS ONE.
 *
 * ⚠ IT IS A SLOT, NOT A STYLE HOOK. `"pill"` mounts it inside the row below; main's card mounts it
 * at the end of its TOOLBAR row (Samuel, live review 2026-08-28) — the arrow moved, the FACE did
 * not, and there is still no `className`, no `size` and no `variant` for a caller to nudge. That
 * is the whole reason main lifts this rather than `<SendButton>` itself.
 */
export function ComposerSend({ onSend, sendDisabled, sendTitle, sendLabel }: ComposerSendWiring) {
  return (
    <SendButton
      onClick={onSend}
      disabled={sendDisabled}
      title={sendTitle}
      label={sendLabel}
    />
  );
}

type ComposerInputRowProps = {
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  /** ⚠ The accessible name each surface's own tests address the field by. */
  ariaLabel: string;
  disabled?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
} & (
  /**
   * WHICH BOX THIS ROW IS IN — see the header.
   * ⚠ REQUIRED, with no default: there are two mounts and each one states what it is, so neither
   * can inherit the other's face by accident. `"pill"` = the agent bar, where this row IS the
   * box AND holds the arrow. `"bare"` = inside the channel composer's card, where the CARD is the
   * box and the arrow sits in the card's own toolbar row — so a bare mount is handed no send
   * wiring at all, and the TYPE is what stops one being passed to a row that would drop it.
   */
  | ({ face: "pill" } & ComposerSendWiring)
  | { face: "bare" }
);

export function ComposerInputRow(props: ComposerInputRowProps) {
  const {
    face,
    value,
    onChange,
    onKeyDown,
    placeholder,
    ariaLabel,
    disabled = false,
    inputRef,
  } = props;
  return (
    <div className={cn(ROW_GEOMETRY, face === "pill" && PILL_FACE)}>
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        // ⚠ THE ROW RESTS AT THE SEND BUTTON'S OWN HEIGHT (30px) — one object, one line, which is
        // what "a bar" means. `resize-none` + `overflow-auto` keep a pasted paragraph from growing
        // the composer over what it sits under; Shift+Enter still breaks the line and it scrolls.
        // ⚠ `items-center` ON THE ROW ABOVE IS WHAT ALIGNS THE ARROW to the field — the channel
        // composer used `items-start`, which is why the two buttons sat at different heights.
        className="h-[30px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-[4px] text-lead leading-[22px] text-text-primary outline-none placeholder:text-text-muted"
      />
      {/* ⚠ THE ARROW IS IN THIS ROW ONLY WHERE THIS ROW IS THE WHOLE BOX. Main's card has a
          toolbar row under this one and the arrow lives at the end of it (Samuel, live review
          2026-08-28), mounted from the SAME {@link ComposerSend} — a lifted slot, not a second
          button. */}
      {props.face === "pill" && (
        <ComposerSend
          onSend={props.onSend}
          sendDisabled={props.sendDisabled}
          sendTitle={props.sendTitle}
          sendLabel={props.sendLabel}
        />
      )}
    </div>
  );
}
