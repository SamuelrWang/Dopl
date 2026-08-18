"use client";

import { useState } from "react";
import { useAutoGrowTextarea } from "@/shared/ui/auto-grow-textarea";
import { SendButton } from "@/shared/ui/send-button";
import type { MessageIntent } from "../types";

/**
 * ⚠ THIS IS THE OLD CHANNELS PAGE'S COMPOSER and it is on its way out — the v2
 * surface is `components/channels-v2/composer.tsx`, and this file dies with the
 * page it belongs to (wiring plan Phase 12). It is kept COMPILING and PASSING,
 * not redesigned.
 *
 * **THE PLAIN COMPOSER IS HUMAN CHAT, FULL STOP** (Samuel, MAPPING.md § Q&A
 * second round; retired here in Phase 3). The chat/request intent pill and
 * `lib/composer-mode.ts` are gone, and with them the subject field, the
 * addressee picker, the unaddressed hint and the agent-offline hint — every one
 * of those was request mode's chrome. Raising an agent request is now the "New
 * agent thread" panel's job and only its job.
 *
 * ⚠ `intent: "chat"` IS LOAD-BEARING ON THE WIRE and is why this send still
 * carries options at all. Absence reads as `request` server-side
 * (`schema.ts › MessageIntentSchema`), so dropping the field would silently put
 * every message on this page back on the request lane.
 *
 * What survives, because it is about typing rather than about intent: the
 * concave-field well, the textarea that auto-grows to three lines then scrolls,
 * Enter-sends / Shift+Enter-newlines with an IME guard, the clear-BEFORE-await
 * optimistic handoff, and `SendButton`'s pause face while the round trip is
 * outstanding.
 */

/**
 * ⚠ Declared HERE now. It used to be re-exported from `lib/composer-mode.ts`,
 * which is retired; `channel-pane.tsx` and `channels-view-core.tsx` import it
 * from this module and are unchanged by the move.
 */
export interface SendOptions {
  intent?: MessageIntent;
}

/** The one line under the composer, stating what pressing Enter will DO. */
const HELP_LINE = "Message the channel. No agent is started.";

interface Props {
  /** Resolve when the send settles; a rejection keeps the text for retry. */
  onSend: (body: string, opts?: SendOptions) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageComposer({ onSend, disabled, placeholder }: Props) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  // Grows with the typed lines up to three, then scrolls (shared with the
  // thread window's D7 math). Keyed on `value`, so clearing after a send snaps
  // the field back to one line.
  const textareaRef = useAutoGrowTextarea(value);

  const canSend = value.trim().length > 0 && !sending && !disabled;

  async function sendMessage() {
    if (!canSend) return;
    const submitted = value;
    setSending(true);
    // CLEAR SYNCHRONOUSLY, before the request leaves. This is half of the
    // optimistic send: the caller has already written a pending row into the
    // transcript cache, so the text is not lost by being taken out of the
    // field — it has moved from a draft to a message. Waiting for the round
    // trip is what made the operator's own words sit in the composer through
    // two network hops while a 30px button dimmed.
    setValue("");
    let failed = false;
    try {
      await onSend(submitted, { intent: "chat" });
    } catch {
      // The caller has already toasted the reason and rolled its cache back,
      // so the draft belongs in the field again for a retry.
      failed = true;
    } finally {
      setSending(false);
    }
    // ⚠ Restore ONLY into an empty field. Clearing happens before the await, so
    // the operator may have typed something new while the request was in
    // flight, and an unconditional restore would destroy it.
    if (failed) setValue((current) => (current === "" ? submitted : current));
  }

  return (
    <div className="shrink-0 px-14 pb-5 pt-2">
      <div className="mx-auto max-w-[760px]">
        <div className="concave-field flex items-end gap-2 rounded-[12px] px-3 py-2">
          {/* rows=1 + the min/max heights keep CSS and the growHeight() math in
              agreement: one line at rest, three lines then scroll. The inline
              height the hook sets rides inside that clamp. leading-relaxed is
              1.625em per line, py-1 is 8px of vertical padding. */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              // IME GUARD: while an input method is composing (typing a CJK
              // name, picking from the candidate window), Enter COMMITS the
              // composition — it is not a submit. Without this, composing a
              // handle and pressing Enter sent the half-finished draft.
              // `keyCode === 229` is the legacy signal browsers still emit for
              // a composing keydown when `isComposing` is unset.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? "Message the channel"}
            spellCheck
            className="min-h-[calc(1.625em_+_8px)] max-h-[calc(4.875em_+_8px)] flex-1 resize-none overflow-y-auto bg-transparent py-1 text-body leading-relaxed text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
          />
          {/* THE BUTTON MORPHS while the write is in flight. `SendButton` has
              carried a `mode="pause"` face since it was extracted from the
              desktop session window and no composer ever passed it: the send
              path's only feedback was this same button at 50% opacity. The
              draft is already gone from the field and the message is already
              in the transcript by the time this renders, so the pause face is
              the honest statement of the one thing still outstanding — the
              round trip. It stays disabled because nothing in the web app can
              interrupt a turn yet; the glyph is the signal, not the target. */}
          <SendButton
            mode={sending ? "pause" : "send"}
            onClick={() => void sendMessage()}
            disabled={!canSend}
            label={sending ? "Sending" : "Send message"}
          />
        </div>

        {/* ⚠ FIXED now, where it used to change with the mode. There is one
            thing this composer does, and this is it. */}
        <p className="mt-1.5 text-caption text-text-muted">{HELP_LINE}</p>
      </div>
    </div>
  );
}
