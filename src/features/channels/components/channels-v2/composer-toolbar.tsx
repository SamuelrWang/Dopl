"use client";

/**
 * **THE COMPOSER CARD'S BOTTOM ROW — every glyph, the Discard, and the submit slot.**
 *
 * ⚠ **IT IS A §1 SPLIT, NOT A NEW LAYER** (2026-09-08). `composer.tsx` stood at 561 lines —
 * over the hard cap — and Samuel's toolbar wave (icon squares to the send button's footprint,
 * the mic moved beside the arrow) had to land in it. §1 is explicit that an edit to an
 * over-cap file either splits it or shrinks it, so the ROW came out whole. Nothing about what
 * a control does moved with it: every act is still a callback the card owns.
 *
 * ⚠ **ONE `<div>`, AND THAT IS LOAD-BEARING.** `composer.test.tsx` pins the arrow as a SIBLING
 * of the icon run (same `parentElement`, later in document order) — the property that says the
 * card has one submit and it hangs at the end of this row. Splitting the row into two flex
 * boxes would satisfy neither half.
 *
 * ⚠ **NO STATE LIVES HERE.** The launch dialog, the new-thread dialog, the @-picker and the
 * dictation engine are all the card's; this file is markup plus the two shared geometry
 * constants below.
 *
 * ⚠ **NOTHING IN THIS ROW BRANCHES ON A PANEL ANY MORE (2026-09-08).** `panelOpen` — and with it
 * the hidden `@` glyph and the labeled submit button — went when the INLINE request panel was
 * deleted; both composer forms are modals with their own footers, so every control here renders
 * unconditionally and the submit has one face. Restoring a branch here means restoring a form to
 * the card, which is the thing that was removed.
 */

import { AtSign, Bot, MessageSquarePlus, Mic, Smile } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { IconButton } from "./bits";
import { ComposerSend } from "./composer-input";
import type { Dictation } from "./use-dictation";
import type { AgentLaunchControls } from "./use-agents-panel";

/**
 * **EVERY TOOLBAR GLYPH IS THE SEND BUTTON'S OWN SQUARE** (Samuel, 2026-09-08: *"increase the
 * size of the icons on the right inside, so that their shadow when hovered over, is the same
 * size as that of the send button"*).
 *
 * ⚠ **THE NUMBER IS `--action-h-sm`, NOT A RE-TYPED 30.** `send-button.tsx` draws a 30px face
 * and `docs/DESIGN-SYSTEM.md` names that token as the small-action scale the composer's
 * Discard already reads; a literal here is how the hover footprint drifts off the arrow's the
 * next time the scale moves. The glyphs were `h-6 w-6` (24px) with a 15px icon.
 * ⚠ **`rounded-full`, WHICH IS THE ONE THING THAT DOES NOT MATCH THE ARROW** — Samuel asked
 * for round glyph buttons beside the arrow's `rounded-[8px]`. The FOOTPRINT is what had to
 * match, and it does.
 * ⚠ **THE HOVER FILL IS `IconButton`'s OWN `hover:bg-surface-raised-1`** — the same token the
 * Discard beside them wears — so it is not restated here and cannot drift from either.
 */
// ⚠ BACK TO THE 24px FACE (Samuel, 2026-09-08: "decrease it back to its original size, but keep
// the icon on the right") — the 30px trial lasted one look. Order stays Discard · Dictate · Send.
export const TOOLBAR_ICON = "h-6 w-6 rounded-full";

/** The glyph for the 24px square. */
export const TOOLBAR_GLYPH = 15;

export function ComposerToolbar({
  newAgent,
  launchOpen,
  onToggleLaunch,
  onNewThread,
  onMention,
  dictation,
  hasContent,
  onClear,
  submitHint,
  submitDisabled,
  onSubmit,
}: {
  newAgent?: AgentLaunchControls;
  /** The New agent DIALOG's own open state — the Bot icon's pressed face, nothing else. */
  launchOpen: boolean;
  onToggleLaunch: () => void;
  /** ⚠ **OPEN, NOT TOGGLE** (2026-09-08). Both thread forms are one popup now, and the card
   *  nonces it; a glyph that could SHUT the dialog from behind its own scrim would be a second
   *  answer to "how does this form close". The card closes the launch form inside this. */
  onNewThread: () => void;
  onMention: () => void;
  dictation: Dictation;
  hasContent: boolean;
  onClear: () => void;
  submitHint: string;
  submitDisabled: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {/* NEW AGENT — my own agent, on this machine, over the bridge. It posts nothing and sends
          no first message: the engine spawns it IDLE and the operator talks to it from there.
          ⚠ IT OPENS THE LAUNCH DIALOG (2026-08-27, Samuel), where it used to spawn a blank
          agent on the click. **The chevron beside it went with that change** — choosing a
          template is the dialog's Template row, and a second way to pick an identity is how two
          controls come to mean one thing.
          ⚠ RENDERED ONLY WHERE IT CAN WORK. `canLaunch` is the bridge op's own detection
          (`agents-controls.ts › canLaunchAgents`), so the web tree and the pop-out get no
          affordance for a thing they cannot do — never a button that can only refuse (F-212).
          ⚠ DISABLED ONLY WHILE ONE IS IN FLIGHT. Every click mints a NEW instance
          (2026-08-21); agents already standing are not a reason to take the control away. */}
      {newAgent?.canLaunch && (
        <IconButton
          icon={Bot}
          label="New Agent"
          size={TOOLBAR_GLYPH}
          className={TOOLBAR_ICON}
          active={launchOpen}
          disabled={newAgent.launchBusy}
          onClick={onToggleLaunch}
        />
      )}
      {/* NEW THREAD — moved off the Bot icon in 2026-08-21, and WIRED TO THE POPUP on 2026-09-08
          (Samuel: *"there is an icon in the text input bar that is supposed to spawn new threads.
          Why wasn't that wired in"*). It opened an inline panel on this card until then and that
          panel is DELETED, so there is no open state for this glyph to press against — the form
          it asks for draws its own scrim, and `aria-pressed` on a control that cannot also close
          it would be a claim nothing here can keep true. */}
      <IconButton
        icon={MessageSquarePlus}
        label="New thread"
        size={TOOLBAR_GLYPH}
        className={TOOLBAR_ICON}
        onClick={onNewThread}
      />
      {/* ⚠ IT OPENS THE PICKER BY WRITING THE `@` (Samuel, 2026-08-27) — it was inert, a glyph
          beside a working control, which §5's interaction-completeness ruling forbids. There is
          no second "open the popover" path to keep in step: the popover is a pure function of
          the draft (`mentionQuery`), so the honest way to open it is to put the token the
          operator would have typed, then focus the caret after it.
          ⚠ IT IS UNCONDITIONAL AGAIN SINCE 2026-09-08. It was hidden on `panelOpen` from
          2026-08-28, because the inline panels unmounted the textarea it writes into and the
          click then typed into a box nobody could see. Both forms are modals now, the textarea
          never leaves, and a glyph gated on a condition that can no longer be true is dead
          branch dressed as a rule. */}
      <IconButton
        icon={AtSign}
        label="Mention"
        size={TOOLBAR_GLYPH}
        className={TOOLBAR_ICON}
        onClick={onMention}
      />
      {/* ⚠ NO "EXPAND COMPOSER" GLYPH, NO SHORTCUTS (Zap), NO ATTACH (Paperclip) — DELETED,
          not hidden (Samuel, live reviews 2026-08-28 and 2026-09-04). None of the three ever
          carried an `onClick`, so nothing became unreachable, and §5's interaction-completeness
          rule forbids a control that cannot act. ⚠ THE MUTATION THESE LINES EXIST TO STOP is
          somebody "completing" the toolbar by putting one back on the way to wiring it. Bring
          the glyph back WITH its feature, not before. ⚠ EMOJI IS STILL INERT AND STILL HERE:
          it was not in the ruling, and deleting a third control on my own initiative is a
          product decision nobody made. */}
      <IconButton icon={Smile} label="Emoji" size={TOOLBAR_GLYPH} className={TOOLBAR_ICON} />
      <span className="flex-1" />
      {/* ⚠ ONLY WHEN THERE IS SOMETHING TO DISCARD (Samuel, 2026-08-27). It rendered always,
          which put a dead control beside the send button on an empty composer.
          ⚠ IT SITS BEFORE THE MIC, NOT AFTER: Samuel's 2026-09-08 ruling is that the mic is
          *"directly to the left of the send button"*, and a Discard that appeared the moment a
          character was typed would otherwise shove itself into that pair. */}
      {hasContent && (
        <button
          type="button"
          onClick={onClear}
          className="flex h-[var(--action-h-sm)] items-center rounded-[8px] px-2.5 text-caption font-medium text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
        >
          Discard
        </button>
      )}
      {/* DICTATION — the browser's own `SpeechRecognition`, no key and no dependency
          (`use-dictation.ts`, which carries the whole rationale).
          ⚠ IT MOVED HERE FROM THE HEAD OF THE ICON RUN ON 2026-09-08 (Samuel: *"move the mic
          icon, to be directly to the left of the send button"*) — the two controls that ACT on
          a finished draft now stand together at the right end, and the four that open a
          surface stand together at the left.
          ⚠ ABSENT WHERE THE BROWSER HAS NO ENGINE (Firefox), never disabled — the
          feature-detection rule every affordance in this family follows.
          ⚠ RED IS "CAPTURING RIGHT NOW", set from the engine's own `onstart`, so a refused
          microphone leaves the glyph exactly as it was.
          ⚠ AND A FAULT IS SAID OUT LOUD SINCE 2026-09-08 (Samuel: *"it shows red for a second
          then turns off"*). The engine's `onerror` used to be swallowed into a bare `stop()`,
          so a session that started and then failed — which is EXACTLY what Electron does, its
          Chromium carrying no Google speech key — read as a glyph that blinked for no reason.
          `dictation.error` is the engine's own code in the operator's words, and it rides the
          `label` so it is both the tooltip AND the accessible name. NOT a paragraph under the
          card (Samuel's minimal-copy ruling): the control that failed says so itself. */}
      {dictation.supported && (
        <IconButton
          icon={Mic}
          label={dictation.error ?? (dictation.listening ? "Stop dictation" : "Dictate")}
          size={TOOLBAR_GLYPH}
          active={dictation.listening}
          onClick={dictation.toggle}
          className={cn(
            TOOLBAR_ICON,
            // ⚠ BOTH HALVES: the hover would otherwise repaint the red on the way to the
            // second click, which is the click that STOPS it.
            (dictation.listening || dictation.error !== null) &&
              "text-danger hover:text-danger"
          )}
        />
      )}
      {/* ⚠ ONE FACE SINCE 2026-09-08, AND IT HANGS HERE — right end of this row, level with the
          icons (Samuel, live review 2026-08-28). The ARROW used to sit in the input row beside
          the field, which put the card's one submit at the TOP-right while every other control
          sat along the bottom.
          ⚠ THE LABELED-BUTTON FACE IS DELETED, NOT HIDDEN. It rendered on `panelOpen` and wore
          the panel's verb ("Create" / "Launch"), because a form standing ON this card submitted
          through this control. Both forms are dialogs with their own footer button now, so this
          row's submit has exactly one act and the branch could only ever take one side. The
          2026-08-27 rule it served — *two submits on one card is two answers to "what does
          pressing this do"* — is what deleting it keeps.
          ⚠ THE FACE IS STILL NOT BUILT HERE: `ComposerSend` is the shared slot. A
          `<SendButton>` at this call site is the regression that made the two composers differ,
          and `composer-input.test.ts` pins its absence. ⚠ DISABLED WITH A REASON (§8, rule 4). */}
      <ComposerSend
        onSend={onSubmit}
        sendDisabled={submitDisabled}
        sendTitle={submitHint}
        sendLabel="Send"
      />
    </div>
  );
}
