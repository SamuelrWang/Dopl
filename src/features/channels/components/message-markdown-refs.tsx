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

import {
  MESSAGE_REF_TOKEN_ANY_RE,
  MESSAGE_REF_TOKEN_RE,
  isCitableSeq,
  messageRefNumber,
  messageRefSeq,
} from "../lib/message-refs";
import { findCite } from "../lib/cites";
import { cn } from "@/shared/lib/utils";
import type { BodyContext } from "./message-markdown-context";

/**
 * ⚠ **THE CHIP RECIPE IS `AgentChip`'s, NOT A NEW ONE** (`attribution-pill.tsx`):
 * a small flat grey capsule at `text-micro`, which is what every inline marker in
 * this transcript already looks like. What it adds is PRESSABILITY — the 1px
 * press the app expresses everywhere — and `tabular-nums`, so a column of
 * citations does not jitter.
 */
export const CITE_PILL =
  "mx-0.5 inline-flex items-center rounded-full bg-bg-inset px-1.5 py-px align-baseline text-micro tabular-nums text-text-secondary transition-transform duration-150 hover:bg-surface-raised-1 hover:text-text-primary active:translate-y-px motion-reduce:transition-none";

/**
 * **WHICH GRAMMAR THIS BODY IS READ UNDER** (grammar B, card #4401, 2026-10-12).
 *
 * Three states arrive in one field (`lib/cites.ts › MessageCites`) and each gets
 * a different reading of the same text:
 *
 *   `null` / absent  the row predates the rule (or the server is older) — the
 *                    LEGACY arm below, byte-for-byte what shipped.
 *   `[]`             written under the rule, cited nothing: **no pill anywhere**,
 *                    so `my #1 priority` is prose. The common case.
 *   `[…]`            written under the rule: only a number naming one of these
 *                    becomes a pill, at any digit length.
 *
 * ⚠ **THE EMPTY CASE RETURNS THE TEXT WHOLE AND SPLITS NOTHING.** It is not an
 * optimisation: splitting would still produce no pills, but it would also be the
 * place a future edit could quietly grow one. Nothing to match against is
 * expressed as nothing to match.
 */
export function MessageRefText({ text, ctx }: { text: string; ctx: BodyContext }) {
  const cites = ctx.cites;
  if (cites != null) {
    return cites.length === 0 ? (
      <>{text}</>
    ) : (
      <CitedRefText text={text} cites={cites} jump={ctx.onJumpToSeq} />
    );
  }
  return <LegacyRefText text={text} ctx={ctx} />;
}

/**
 * **THE ALLOWLIST ARM** — the server already decided what this body cites.
 *
 * ⚠ **`isCitableSeq` IS DELIBERATELY NOT CONSULTED HERE.** That gate exists to
 * refuse a number this channel could not hold, which was the second half of a
 * GUESS: nothing had vouched for the reference. Here the write path resolved every
 * entry against this channel and refused the send otherwise
 * (`service-writes-metadata-cites.ts`), so the row's existence is established —
 * and re-applying the pane's ceiling would mean a pane that has not yet loaded a
 * page (`newestSeq === null`) drew no pills for citations it has been handed.
 *
 * ⚠ **IT JUMPS BY `seq`, NOT BY `messageId`, AND THE REASON IS PAGE-BACK.** The
 * id is the authoritative pointer and the one a client should use for identity —
 * but the host's jump takes a seq and turns a miss into a `seq:<n>` sentinel that
 * `use-jump-page-back.ts` can HUNT by loading older pages. Handing it a bare id
 * for a row outside the loaded window would give the hunt nothing to look for.
 * Both numbers name the same row, so this costs nothing and keeps one mechanism.
 */
function CitedRefText({
  text,
  cites,
  jump,
}: {
  text: string;
  cites: NonNullable<BodyContext["cites"]>;
  jump: BodyContext["onJumpToSeq"];
}) {
  return (
    <>
      {text.split(MESSAGE_REF_TOKEN_ANY_RE).map((part, i) => {
        const raw = part ?? "";
        const n = messageRefNumber(raw);
        const cite = n === null ? null : findCite(cites, n);
        // ⚠ A NUMBER THE AUTHOR DID NOT CITE IS TEXT, which is the ruling itself:
        // typing `#12` does not make a reference, citing message 12 does.
        if (jump === undefined || cite === null) {
          return <span key={i}>{raw}</span>;
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => jump(cite.seq)}
            aria-label={`Go to message ${raw.replace(/^seq /i, "#")}`}
            className={cn(CITE_PILL, "cursor-pointer")}
          >
            {raw}
          </button>
        );
      })}
    </>
  );
}

/**
 * **THE LEGACY ARM, UNCHANGED** — a row written before the stamp existed.
 *
 * ⚠ **THE TWO-DIGIT FLOOR AND THE CEILING BOTH STAY HERE**, because for these
 * rows nothing vouched for the number and a pill is still a guess. Keeping the
 * old face exactly is also what makes the DTO's "unknown mode falls back to
 * legacy" safe: the fallback is a behaviour that shipped and works.
 */
function LegacyRefText({ text, ctx }: { text: string; ctx: BodyContext }) {
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
            className={cn(CITE_PILL, "cursor-pointer")}
          >
            {raw}
          </button>
        );
      })}
    </>
  );
}
