"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useAutoGrowTextarea } from "@/shared/ui/auto-grow-textarea";
import { SendButton } from "@/shared/ui/send-button";
import { CHIP, RAISED_WELL } from "@/shared/ui/wells";
import styles from "../knowledge-v2.module.css";

/**
 * HERO CHAT — gray panel attached under the knowledge hero image band.
 *
 * ⚠ DESIGN ONLY. No route, no query, no transcript. Send appends a HARDCODED
 * reply; the mic is a pressed STATE with no recognition behind it.
 *
 * Not its own card: `.homeHero` is one `overflow:hidden` rounded container, so
 * neither child carries a radius. Fill is `bg-bg-inset` — same token as
 * `.cardInset` — so it reads as an inset extension, not a stacked card.
 * `bg-card-surface-subtle` reads as a lid; `--shell-chip` is nav chrome.
 *
 * Reuses shared composer pieces (`SendButton`, auto-grow textarea, `CHIP` /
 * `RAISED_WELL`) but NOT the channels composer: that one is feature-coupled
 * (channel roster, addressee panel, channel send payload). Input well composes
 * the `.concave-field` kit recipe instead. ⚠ The composer named here was
 * `channels/components/message-composer.tsx`, deleted at the v2 cutover
 * (2026-08-18); its replacement, `channels-v2/composer.tsx`, is coupled the
 * same way and the reason to keep them apart is unchanged.
 */

/** ⚠ The one place this string is written. */
export const HERO_CHAT_PLACEHOLDER =
  "Create, edit, or ask about your knowledge bases...";

export const HERO_CHAT_REPLY =
  "This feature is coming soon! For now, your AI agent delivers the same functionalities over Dopl MCP.";

/** Clicking one FILLS the input; it does not send. */
const SUGGESTIONS = [
  "Summarize a knowledge base",
  "Draft a new base from my notes",
  "Find where X is documented",
];

const HINT_IDLE = "Answers draw on the bases you can see.";
const HINT_LISTENING = "Dictation is not wired up yet — this is the pressed state only.";

/** ⚠ Must match the `.heroChatReveal` transition. */
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

  // Pending collapse holds the log mounted so it has a height to animate DOWN
  // from; clear on unmount or the wipe lands on a dead component.
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

  /** ⚠ Collapse in TWO steps, order matters: flip the flag first so the grid
   *  track animates 1fr→0fr with the log still in it, wipe turns only after.
   *  Clearing turns first animates an empty track — a jump. */
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
      {/* Auto-height via `grid-template-rows: 0fr → 1fr` over an
          `overflow:hidden` child — no measurement, no ResizeObserver, no
          max-height guess. See `.heroChatReveal`. */}
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

              {/* `polite`, not `assertive`: a reply is not an alert. Region is
                  the LOG so each appended turn is announced. Height caps at
                  ~10 lines (.heroChatLog), then scrolls internally. */}
              <div
                className={cn(styles.heroChatLog, "flex flex-col gap-3")}
                aria-live="polite"
              >
                {turns.map((turn) => (
                  <div key={turn.id} className="flex flex-col gap-2">
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

      <div className="concave-field flex items-end gap-2 rounded-[12px] py-1.5 pl-3 pr-1.5">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // ⚠ IME GUARD (same as channel composer): while composing, Enter
            // COMMITS the composition — not a send.
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
