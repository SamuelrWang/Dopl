"use client";

/** The composer card's bottom row: glyphs, Discard and the submit slot. Stateless — every act is the card's callback. */

import { AtSign, Bot, MessageSquarePlus, Mic, Smile } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { IconButton } from "./bits";
import { ComposerSend } from "./composer-input";
import type { Dictation } from "./use-dictation";
import type { AgentLaunchControls } from "./use-agents-panel";

/** The toolbar glyph face: muted at rest; the hover fill and ink are `IconButton`'s own. */
const TOOLBAR_ICON = "h-6 w-6 rounded-full text-text-muted";

/**
 * **A GLYPH WHOSE POPUP IS OPEN IS THE BLACK BUTTON — a ROUNDED SQUARE, white glyph**
 * (Samuel, 2026-10-12: *"while their popup is OPEN, today they become a circle. Instead
 * show a ROUNDED SQUARE, black fill, white icon"*).
 *
 * ⚠ **IT IS AN ALTERNATIVE TO {@link TOOLBAR_ICON}, NEVER A LAYER OVER IT.** The two are
 * handed to `className` whole ({@link openFace}), so the radius is a straight swap —
 * `rounded-full` and `rounded-[7px]` are one tailwind-merge group and a composed pair
 * would resolve by string order, which is the silent-circle bug this shape makes
 * unreachable. `rounded-[7px]` is `icon-button.tsx`'s OWN radius, i.e. this control's
 * square corner, not a new number.
 * ⚠ **THE TWO HOVER CLASSES ARE THE RULING "the open face must win over the hover fill",
 * AND THEY ARE NOT BELT-AND-BRACES.** `IconButton`'s resting arms are `hover:bg-surface-raised-1`
 * and `hover:text-text-primary`, and tailwind-merge keeps a `hover:` variant INDEPENDENTLY of
 * its unprefixed twin — so without these the open glyph repaints to grey, with dark ink, the
 * moment the cursor is on it, which is the state the operator is in every time they open one
 * of these popups. Restating the open face at `hover:` is what pins it.
 * ⚠ **FLAT CTA, NOT `.auth-btn-3d`.** Samuel named `bg-surface-cta` / `text-text-on-cta` —
 * two tokens, no gradient and no elevation — which is the same pair `agent-bits.tsx ›
 * AGENT_PILL_FACE` wears. The raised black button is a 36px page ACTION; this is a 24px
 * chrome glyph and borrowing that recipe would put a second button scale in the row.
 */
const TOOLBAR_ICON_OPEN =
  "h-6 w-6 rounded-[7px] bg-surface-cta text-text-on-cta hover:bg-surface-cta hover:text-text-on-cta";

/**
 * The face one glyph wears for its popup's state. ⚠ **ONE FUNCTION, THREE CALLERS, because
 * the three popups are the same fact about different surfaces** — a per-glyph ternary is how
 * two of them end up on slightly different blacks.
 */
function openFace(open: boolean): { className: string } {
  return { className: open ? TOOLBAR_ICON_OPEN : TOOLBAR_ICON };
}

/** The glyph for the 24px square. */
const TOOLBAR_GLYPH = 15;

export function ComposerToolbar({
  newAgent,
  launchOpen,
  onToggleLaunch,
  onNewThread,
  threadOpen,
  onMention,
  mentionOpen,
  dictation,
  hasContent,
  onClear,
  submitHint,
  submitDisabled,
  onSubmit,
}: {
  newAgent?: AgentLaunchControls;
  /** The New Agent dialog's open state — the Bot icon's pressed face. */
  launchOpen: boolean;
  onToggleLaunch: () => void;
  /** Opens, never toggles, the new-thread dialog — it cannot shut a dialog from behind its scrim. */
  onNewThread: () => void;
  /** The new-thread dialog's open state — the glyph's {@link TOOLBAR_ICON_OPEN} face. ⚠ REPORTED
   *  UP by the dialog (`new-thread-dialog.tsx › onOpenChange`), which still OWNS the state. */
  threadOpen: boolean;
  onMention: () => void;
  /** The @-popover's open state — `mentionQuery(draft) !== null`, so typing an `@` lights this
   *  glyph exactly as clicking it does (`composer.tsx` passes it). */
  mentionOpen: boolean;
  dictation: Dictation;
  hasContent: boolean;
  onClear: () => void;
  submitHint: string;
  submitDisabled: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {/* Opens the New Agent dialog (`launch-agent-dialog.tsx`). Rendered only where `canLaunch`
          (`agents-controls.ts › canLaunchAgents`); disabled only while a launch is in flight. */}
      {newAgent?.canLaunch && (
        <IconButton
          icon={Bot}
          label="New Agent"
          size={TOOLBAR_GLYPH}
          {...openFace(launchOpen)}
          active={launchOpen}
          /* ⚠ `bare` SUPPRESSES `.raised-tab`, and this is the ONE glyph that needs it: it is a
             real toggle, so it keeps `active` (and the `aria-pressed` that goes with it), and
             `active` is what paints the kit's raise. {@link TOOLBAR_ICON_OPEN} is the whole face
             now, so the raise under it would be an elevation Samuel's ruling removes. */
          bare={launchOpen}
          disabled={newAgent.launchBusy}
          onClick={onToggleLaunch}
        />
      )}
      {/* No `aria-pressed`: it opens the dialog but cannot close it. ⚠ THAT RULING IS WHY THE OPEN
          FACE IS `className` AND NOT `active` — a glyph that cannot shut its own dialog is not a
          toggle, and `openFace` paints the state without claiming one. */}
      <IconButton
        icon={MessageSquarePlus}
        label="New thread"
        size={TOOLBAR_GLYPH}
        {...openFace(threadOpen)}
        onClick={onNewThread}
      />
      {/* Writes an `@` and focuses: the popover is a pure function of the draft (`mentionQuery`),
          so the open face follows the DRAFT rather than this click. */}
      <IconButton
        icon={AtSign}
        label="Mention"
        size={TOOLBAR_GLYPH}
        {...openFace(mentionOpen)}
        onClick={onMention}
      />
      {/* Emoji is inert; any other glyph comes back only with its feature (INVARIANTS §5). */}
      <IconButton icon={Smile} label="Emoji" size={TOOLBAR_GLYPH} className={TOOLBAR_ICON} />
      <span className="flex-1" />
      {/* Only with a draft, and before the mic so the mic stays directly left of send. */}
      {hasContent && (
        <button
          type="button"
          onClick={onClear}
          className={SMALL_TEXT_BUTTON}
        >
          Discard
        </button>
      )}
      {/* 🔴 **THE PARTIAL PREVIEW IS GONE FROM HERE, AND THAT IS THE RULING** (Samuel,
          2026-10-12: *"text collects LEFT of the mic and only enters the input when dictation
          ends. Make it stream into the input live"*). A `max-w-[40%]` truncated caption sat in
          this slot showing the phrase being spoken. ⚠ **IT IS NOT MOVED, IT IS RETIRED**: the
          words are in the box as they are heard now (`dictation/insert-text.ts`), so a second
          copy of them beside the mic would be the same fact twice — and the clipped one would
          be the worse of the two to read. */}
      {/* Absent where a browser has no engine; always present on the desktop, where an unavailable
          engine still says why. Red = capturing or a fault: the reason is the accessible name, the
          tooltip adds what to do about it (`dictation/faults.ts`). */}
      {dictation.supported && (
        <IconButton
          icon={Mic}
          label={dictation.error ?? (dictation.listening ? "Stop dictation" : "Dictate")}
          title={
            dictation.error && dictation.hint ? `${dictation.error}. ${dictation.hint}` : undefined
          }
          size={TOOLBAR_GLYPH}
          active={dictation.listening}
          /**
           * **CAPTURING IS A RED GLYPH AND NOTHING ELSE — no circle, no elevation, no
           * background** (Samuel, 2026-10-12: *"today it gets a circle, elevates, and
           * turns red. Make it ONLY the icon turning red"*).
           *
           * ⚠ **`bare` IS THAT RULING ALREADY WRITTEN DOWN**, which is why no prop was
           * added for it: `icon-button.tsx › bare` suppresses the `active` raise
           * (`.raised-tab` — the fill the toolbar's `rounded-full` was drawing as a
           * circle, and the elevation with it) and its own docblock states the reason
           * this control can afford that — *"the colour shift is the whole affordance
           * either way, and `aria-pressed` still carries the state"*. Red IS the colour
           * shift here, so the raise was the one surface in this row saying a thing its
           * glyph already said.
           * ⚠ **IT IS BOUND TO `listening`, NOT PASSED FLAT, because the RESTING face is
           * unchanged** — the quiet hover fill every sibling glyph wears. `bare` would
           * take that too (it is the absence of the resting surface as well), and this
           * ruling was about the pressed state only.
           * ⚠ **THE FAULT FACE NEVER HAD A RAISE TO LOSE**: `error` is red ink on a
           * button that is not `active`, so it is untouched by this and stays hoverable.
           * ⚠ **`h-6 w-6` SURVIVES** — `bare`'s 32px hit area is a BASE class and
           * `TOOLBAR_ICON` is `className`, which tailwind-merge resolves last, so the
           * glyph does not resize when capture opens (`composer-toolbar.test.tsx` pins
           * the 24px face).
           */
          bare={dictation.listening}
          onClick={dictation.toggle}
          className={cn(
            TOOLBAR_ICON,
            // Both halves, so hover doesn't repaint the red before the click that stops it.
            (dictation.listening || dictation.error !== null) &&
              "text-danger hover:text-danger"
          )}
        />
      )}
      {/* The card's one submit: the shared `ComposerSend` slot, never a hand-built button. `composer.test.tsx`
          pins it as a sibling of the icons, so this stays one row. */}
      <ComposerSend
        onSend={onSubmit}
        sendDisabled={submitDisabled}
        sendTitle={submitHint}
        sendLabel="Send"
      />
    </div>
  );
}
