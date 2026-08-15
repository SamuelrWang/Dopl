"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useAutoGrowTextarea } from "@/shared/ui/auto-grow-textarea";
import { SendButton } from "@/shared/ui/send-button";
import { CHIP, RAISED_WELL } from "@/shared/ui/wells";
import styles from "../knowledge-v2.module.css";

/**
 * HERO CHAT — the gray panel ATTACHED to the bottom of the knowledge hero.
 *
 * ⚠ DESIGN ONLY. Nothing here talks to a server: there is no route, no query,
 * no transcript. Sending appends a HARDCODED reply so the shape of the feature
 * can be reviewed live; the reply says so in its own words rather than
 * pretending, and the mic is a pressed STATE with no recognition behind it.
 *
 * WHY IT IS NOT ITS OWN CARD. The hero is one rounded container: the image
 * band keeps the top corners, this keeps the bottom ones, and the container's
 * single border wraps both (`.homeHero` is `overflow:hidden`, so neither child
 * carries a radius of its own). The fill is `bg-bg-inset` — the SAME token as
 * the card grid's own wells (`.cardInset`) — which is what makes it read as an
 * inset extension of the hero rather than a second floating card stacked under
 * it. `bg-card-surface-subtle` (header strips) reads as a lid, not a well, and
 * `--shell-chip` belongs to nav chrome.
 *
 * REUSE: the SHARED composer pieces are reused (`SendButton`, the auto-grow
 * textarea math, `CHIP`/`RAISED_WELL`); the channel `MessageComposer` is not,
 * because it is feature-coupled — it takes a channel roster, owns the
 * chat/request intent pill and the addressee picker, and its send path builds
 * a channel payload. The input well is therefore composed from the sanctioned
 * `.concave-field` kit recipe, exactly as that composer does.
 */

/** Verbatim, and the one place it is written. */
export const HERO_CHAT_PLACEHOLDER =
  "Create, edit, or ask about your knowledge bases...";

/**
 * The canned turn. Deliberately says what is and is not wired: a design pass
 * that reads as a working feature is how a placeholder ships.
 */
export const HERO_CHAT_REPLY =
  "This feature is coming soon! For now, your AI agent delivers the same functionalities over Dopl MCP.";

/** Canned prompts. Clicking one FILLS the input; it does not send. */
const SUGGESTIONS = [
  "Summarize a knowledge base",
  "Draft a new base from my notes",
  "Find where X is documented",
];

const HINT_IDLE = "Answers draw on the bases you can see.";
const HINT_LISTENING = "Dictation is not wired up yet — this is the pressed state only.";

/** Matches the `.heroChatReveal` transition; the log is wiped once it lands. */
const COLLAPSE_MS = 300;

interface Turn {
  id: number;
  user: string;
  agent: string;
}

export function HeroChat() {
  const [value, setValue] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const inputRef = useAutoGrowTextarea(value);
  const nextId = useRef(1);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending collapse holds the log mounted so it has a height to animate
  // DOWN from. Unmounting on unmount too, or a wipe lands on a dead component.
  useEffect(
    () => () => {
      if (collapseTimer.current !== null) clearTimeout(collapseTimer.current);
    },
    []
  );

  const send = useCallback(() => {
    const body = value.trim();
    if (body === "") return;
    if (collapseTimer.current !== null) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setTurns((current) => [
      ...current,
      { id: nextId.current++, user: body, agent: HERO_CHAT_REPLY },
    ]);
    setOpen(true);
    setValue("");
  }, [value]);

  /**
   * Collapse in TWO steps, and the order is the whole trick: the flag flips
   * first so the grid track animates 1fr→0fr with the log still in it, and the
   * log is wiped only once that has run. Clearing the turns first would leave
   * an empty track to "animate", i.e. a jump.
   */
  const clear = useCallback(() => {
    setOpen(false);
    if (collapseTimer.current !== null) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null;
      setTurns([]);
    }, COLLAPSE_MS);
  }, []);

  return (
    <div className="flex flex-col border-t border-border-default bg-bg-inset px-3.5 pb-3 pt-3">
      {/* THE ANIMATION. `grid-template-rows: 0fr → 1fr` over an
          `overflow:hidden` child is the one auto-height transition that needs
          no measurement — no ResizeObserver, no max-height guess that clips a
          long turn or eases against a number nothing reaches. Everything below
          the hero (the scope pills, the card grid) is in normal flow, so it
          slides down with it for free. */}
      <div className={styles.heroChatReveal} data-open={open ? "true" : undefined}>
        <div className={styles.heroChatRevealInner}>
          {turns.length > 0 && (
            <div className="flex flex-col gap-2.5 pb-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
                  Assistant
                </span>
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Clear conversation"
                  className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
                >
                  <X size={13} />
                </button>
              </div>

              {/* `polite`, not `assertive`: a reply appearing is not an alert.
                  The region is the LOG, so each appended turn is announced.
                  Height CAPS at ~10 text lines (.heroChatLog) — the reveal
                  animation still runs to the capped height, and past it the
                  log scrolls internally instead of growing the box. */}
              <div
                className={cn(styles.heroChatLog, "flex flex-col gap-3")}
                aria-live="polite"
              >
                {turns.map((turn) => (
                  <div key={turn.id} className="flex flex-col gap-2">
                    {/* The user's words are ELEVATED (raised well on the inset
                        body); the agent's are FLAT on the gray, no bubble —
                        one voice is a thing you said, the other is the
                        surface answering. */}
                    <p
                      className={cn(
                        RAISED_WELL,
                        "max-w-[76%] self-end whitespace-pre-wrap break-words px-3 py-1.5 text-body leading-relaxed text-text-primary"
                      )}
                    >
                      {turn.user}
                    </p>
                    <p className="px-0.5 text-body leading-relaxed text-text-primary">
                      {turn.agent}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The input row stays put — it is the bottom of the box in BOTH states,
          so the next turn is typed where the last one was. */}
      <div className="concave-field flex items-end gap-2 rounded-[12px] py-1.5 pl-3 pr-1.5">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // IME GUARD, same as the channel composer: while an input method
            // is composing, Enter COMMITS the composition — it is not a send.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={HERO_CHAT_PLACEHOLDER}
          aria-label="Ask about your knowledge bases"
          spellCheck
          className="min-h-[calc(1.625em_+_8px)] max-h-[calc(4.875em_+_8px)] flex-1 resize-none overflow-y-auto bg-transparent py-1 text-body leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
        />
        <button
          type="button"
          onClick={() => setListening((on) => !on)}
          aria-pressed={listening}
          aria-label="Dictate a message"
          className={cn(
            "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] transition-colors",
            listening
              ? "bg-danger/10 text-danger"
              : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary"
          )}
        >
          <Mic size={15} />
        </button>
        <SendButton
          onClick={send}
          disabled={value.trim() === ""}
          label="Send to the assistant"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Suggestions are an IDLE affordance: once there is a conversation the
            next prompt is the one in your head, not one of three. */}
        {turns.length === 0 &&
          SUGGESTIONS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => {
                setValue(prompt);
                inputRef.current?.focus();
              }}
              className={cn(CHIP, "transition-colors hover:bg-bg-elevated-hover")}
            >
              {prompt}
            </button>
          ))}
        <p className="ml-auto text-caption text-text-muted">
          {listening ? HINT_LISTENING : HINT_IDLE}
        </p>
      </div>
    </div>
  );
}
