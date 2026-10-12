"use client";

/** The composer card's bottom row: glyphs, Discard and the submit slot. Stateless — every act is the card's callback. */

import { AtSign, Bot, MessageSquarePlus, Mic, Smile } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { IconButton } from "./bits";
import { ComposerSend } from "./composer-input";
import type { Dictation } from "./use-dictation";
import type { AgentLaunchControls } from "./use-agents-panel";

/** The toolbar glyph face; the hover fill is `IconButton`'s own. */
const TOOLBAR_ICON = "h-6 w-6 rounded-full";

/** The glyph for the 24px square. */
const TOOLBAR_GLYPH = 15;

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
  /** The New Agent dialog's open state — the Bot icon's pressed face. */
  launchOpen: boolean;
  onToggleLaunch: () => void;
  /** Opens, never toggles, the new-thread dialog — it cannot shut a dialog from behind its scrim. */
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
      {/* Opens the New Agent dialog (`launch-agent-dialog.tsx`). Rendered only where `canLaunch`
          (`agents-controls.ts › canLaunchAgents`); disabled only while a launch is in flight. */}
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
      {/* No `aria-pressed`: it opens the dialog but cannot close it. */}
      <IconButton
        icon={MessageSquarePlus}
        label="New thread"
        size={TOOLBAR_GLYPH}
        className={TOOLBAR_ICON}
        onClick={onNewThread}
      />
      {/* Writes an `@` and focuses: the popover is a pure function of the draft (`mentionQuery`). */}
      <IconButton
        icon={AtSign}
        label="Mention"
        size={TOOLBAR_GLYPH}
        className={TOOLBAR_ICON}
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
      {/* The phrase being spoken, before it is final: a preview only, never draft text. */}
      {dictation.listening && dictation.partial && (
        <span
          aria-live="polite"
          className="min-w-0 max-w-[40%] truncate text-small text-text-secondary"
          title={dictation.partial}
        >
          {dictation.partial}
        </span>
      )}
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
