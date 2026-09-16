/**
 * THE MESSAGE-CITATION LEAF — `#1759` in a body becomes a pill that scrolls the
 * transcript to that message (Samuel, 2026-09-15).
 *
 * ⚠ **ITS OWN FILE ON `message-markdown-mentions.tsx`'s PRECEDENT AND FOR ITS
 * REASON**: this is a POLICY about what a citation is and when it is safe to draw
 * one, not markdown plumbing. `lib/message-refs.ts` owns the pattern; this owns
 * the face and the refusal.
 *
 * ⚠ **TWO GATES BEFORE ANY PILL IS DRAWN**, because a pill that jumps nowhere
 * teaches a reader to distrust every pill: the token has to MATCH the
 * conservative pattern, and the seq has to be one this channel could hold. A
 * candidate that fails either renders as the plain text the author typed — never
 * as a disabled pill, which would advertise a destination that does not exist.
 *
 * ⚠ **IT NEVER REWRITES THE BODY.** The stored text is what the author typed on
 * every surface (MCP, notifications, quotes); this splits it for display and puts
 * every character back.
 */

import { MESSAGE_REF_TOKEN_RE, isCitableSeq, messageRefSeq } from "../lib/message-refs";
import { cn } from "@/shared/lib/utils";
import type { BodyContext } from "./message-markdown-context";

/**
 * ⚠ **THE CHIP RECIPE IS `AgentChip`'s, NOT A NEW ONE** (`attribution-pill.tsx`):
 * a small flat grey capsule at `text-micro`, which is what every inline marker in
 * this transcript already looks like. What it adds is PRESSABILITY — the 1px
 * press the app expresses everywhere — and `tabular-nums`, so a column of
 * citations does not jitter.
 */
const PILL =
  "mx-0.5 inline-flex items-center rounded-full bg-bg-inset px-1.5 py-px align-baseline text-micro tabular-nums text-text-secondary transition-transform duration-150 hover:bg-surface-raised-1 hover:text-text-primary active:translate-y-px motion-reduce:transition-none";

export function MessageRefText({ text, ctx }: { text: string; ctx: BodyContext }) {
  const jump = ctx.onJumpToSeq;
  return (
    <>
      {text.split(MESSAGE_REF_TOKEN_RE).map((part, i) => {
        const raw = part ?? "";
        const seq = messageRefSeq(raw);
        // ⚠ THE ORDER MATTERS: no handler, no pattern match, or a seq this channel
        // cannot hold — all three degrade to the author's own text.
        if (jump === undefined || seq === null || !isCitableSeq(seq, ctx.newestSeq ?? null)) {
          return <span key={i}>{raw}</span>;
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => jump(seq)}
            // ⚠ THE LABEL SAYS WHAT PRESSING DOES. "#1759" alone reads as a number
            // to a screen reader, and the one thing a reader cannot see here is
            // that it navigates.
            aria-label={`Go to message ${seq}`}
            className={cn(PILL, "cursor-pointer")}
          >
            {raw}
          </button>
        );
      })}
    </>
  );
}
