"use client";

import { useEffect, useState } from "react";
import { splitWords } from "@/shared/ui/chat-reveal";
import { STEPS } from "./demo-steps";

/**
 * Typewriter for the hero demo's HUMAN lines (2026-10-15), ported from
 * onboarding step 3 (`agents-chat-script.ts › PACE`, `@/shared/ui/chat-reveal`):
 * a person's message lands word by word; agent and system rows arrive whole
 * and fade in (the row rule in banner-demo.tsx).
 *
 * The scene mounts the REAL transcript, so the reveal is a DATA cut: the typed
 * line's body is truncated to its first N words and the product renders that.
 *
 * Who decides N:
 *   - scroll drive: the scroll position inside the step (`frac`), so scrolling
 *     up un-types it. Typing finishes at TYPE_SHARE of the step's range, the
 *     rest is a read pause.
 *   - time drive: the step's own clock at onboarding's user pace, capped so it
 *     always finishes inside TYPE_SHARE of the step's `dur`.
 */

/** Onboarding's `PACE.userWord`. */
const USER_WORD_MS = 80;
const TYPE_SHARE = 0.7;

/** `body` cut to its first `n` words; the original string once all are shown. */
export function revealBody(body: string, n: number): string {
  const words = splitWords(body);
  return n >= words.length ? body : words.slice(0, Math.max(1, n)).join(" ");
}

/** Words of `text` to show on `step`. `frac` = scroll fraction (scroll) or null (time). */
export function useTypedWords(
  step: number,
  text: string | null,
  frac: number | null,
): number {
  const total = text ? splitWords(text).length : 0;
  const [timed, setTimed] = useState({ step: -1, n: 0 });

  // Time drive only: one word per tick from the step's start.
  useEffect(() => {
    if (frac !== null || total === 0) return;
    const per = Math.min(USER_WORD_MS, (STEPS[step].dur * TYPE_SHARE) / total);
    let n = 0;
    let t = 0;
    const tick = () => {
      n += 1;
      setTimed({ step, n });
      if (n < total) t = window.setTimeout(tick, per);
    };
    t = window.setTimeout(tick, 0);
    return () => window.clearTimeout(t);
  }, [step, total, frac]);

  if (total === 0) return 0;
  if (frac !== null) return Math.max(1, Math.ceil((frac / TYPE_SHARE) * total));
  return timed.step === step ? timed.n : 1;
}
