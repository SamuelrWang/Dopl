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
      {/* Absent where the browser has no engine. Red = capturing (from `onstart`) or a fault, whose text
          rides `label` (tooltip and accessible name). */}
      {dictation.supported && (
        <IconButton
          icon={Mic}
          label={dictation.error ?? (dictation.listening ? "Stop dictation" : "Dictate")}
          size={TOOLBAR_GLYPH}
          active={dictation.listening}
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
