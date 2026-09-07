"use client";

/**
 * **THE COMPOSER'S LIVE TINT — a token turns blue AS IT IS TYPED when it will actually route**
 * (2026-09-07, Samuel's ruling: blue means *"will route to an agent"*).
 *
 * ⚠ **IT IS THE TRANSCRIPT'S PROMISE, MOVED ONE MOMENT EARLIER.** A reader already knows blue
 * means "this tag landed" (`message-markdown-mentions.tsx`); until now they only learned it
 * AFTER sending, which is exactly the guest problem `lib/draft-recipients.ts` was built for —
 * *"doesn't know that there's a tagging function and that the tagging function is required"*.
 * The recipient line says WHO in words; this says WHICH WORDS did it, in place, character by
 * character.
 *
 * ⚠ **IT ADDS NO RESOLUTION RULE AND MUST NEVER GROW ONE.** A member tints by
 * `lib/mentions.ts › resolveMentionToken`, an agent by
 * `lib/agent-mentions.ts › resolveAgentHandle` over `lib/draft-recipients.ts › draftAgentIndex`
 * — the SAME index the recipient line predicts with and the picker inserts from. A second
 * spelling of "what counts as an @-tag" is F-266, already paid for twice.
 *
 * ⚠ **MEMBER FIRST, AGENT ONLY WHEN THE ROSTER ANSWERED NOBODY**, which is the transcript's
 * precedence verbatim. It is also structurally redundant here — `draftAgentIndex` reserves the
 * member handles, so no agent holds one — and it stays because the two facts are enforced in
 * different modules and this one must be readable on its own.
 *
 * ⚠ **THE TINT IS COLOUR ONLY: NO WEIGHT, NO BACKGROUND, NO PADDING** — and that is a mirror
 * constraint rather than a taste. This text is painted UNDER a transparent textarea
 * (`composer-input.tsx`), so every glyph has to sit at the character position the real field put
 * it in. `font-medium`, which the transcript uses, changes advance widths and would slide the
 * tint off the caret by a growing fraction of a character across the line. The transcript has no
 * such constraint and keeps its weight.
 *
 * ⚠ **PURE DISPLAY, AND NOT A CLAIM THAT ANYBODY WAS REACHED.** Nothing here addresses, wakes or
 * consents to anything (INVARIANTS §5); the server decides at write time and stores the answer.
 */

import { useMemo } from "react";
import {
  MENTION_TOKEN_RE,
  buildMentionIndex,
  maskNonTaggingRegions,
  mentionHandleOf,
  resolveMentionToken,
} from "../../lib/mentions";
import { resolveAgentHandle } from "../../lib/agent-mentions";
import { draftAgentIndex, liveAgentCandidates, type LiveAgentSession } from "../../lib/draft-recipients";
import type { ChannelMember } from "../../types";

/**
 * The draft, rendered as the mirror layer.
 *
 * ⚠ **IT TAKES THE RAW DRAFT, NOT THE TRIMMED BODY.** The layer has to line up with the field
 * character for character, and `body.trim()` — which the recipient line correctly uses — would
 * drop the leading whitespace the caret is sitting after.
 */
export function ComposerTint({
  text,
  members,
  sessions,
}: {
  text: string;
  members: readonly ChannelMember[];
  /** The room's live agents, exactly as the picker and the recipient line receive them. */
  sessions: readonly LiveAgentSession[];
}) {
  // ⚠ MEMOIZED ON THE INPUTS, NOT ON THE TEXT: the indexes are a property of the ROOM and the
  // draft changes on every keystroke, so rebuilding them per character would walk the whole
  // roster for each letter typed.
  const memberIndex = useMemo(() => buildMentionIndex(members), [members]);
  const agentIndex = useMemo(
    () => draftAgentIndex(liveAgentCandidates(sessions), members),
    [sessions, members]
  );
  // ⚠ **THE CHEAP EXIT IS `mentionTokensOf`'S OWN**, and on this surface it is what keeps the
  // masking off the hot path: this runs on every keystroke and the common draft holds no `@`.
  if (!text.includes("@")) return <>{text}</>;
  // 🔒 **THE MASK RUNS FIRST, AND SKIPPING IT WAS A REAL DEFECT (fixed 2026-09-07, blocker 8).**
  // This split ran over the RAW draft, so `MENTION_TOKEN_RE` saw handles the tagging rule
  // deliberately does not: a backticked `@handle`, a fenced block, an escaped `\@handle`, a link
  // destination. Every one of them tinted BLUE and routed NOBODY — the tint lying in the one
  // direction Samuel forbade, in the surface built to stop exactly that, and F-266's
  // two-ends-disagree failure re-created three weeks after it was paid for. The mask is not an
  // optimisation and it is not the transcript's problem: `marked` gives the transcript the rule
  // structurally, and a plain textarea gets it only by asking for it.
  //
  // ⚠ **WHY THIS COMPOSES `mentionTokensOf`'S TWO HALVES RATHER THAN CALLING IT.** That function
  // is `maskNonTaggingRegions` → `split(MENTION_TOKEN_RE)` → `filter(startsWith("@"))`, and the
  // FILTER is what makes it unusable here: it returns tokens with no positions, and a mirror
  // needs every character in place. Worse, the filter cannot tell two identical tokens apart —
  // in "`@diana` and @diana" one is code and one is live, and a by-value match would tint the
  // wrong one. So the same two calls run, in the same order, and nothing is re-derived: no
  // second mask, no second token rule, no punctuation list.
  const masked = maskNonTaggingRegions(text);
  // ⚠ **THE MASK IS LENGTH-PRESERVING BY CONTRACT — spaces, never deletion** (`mentions-mask.ts`:
  // *"EVERY MASK BLANKS AND NEVER DELETES — same length, spaces in place"*), which is the whole
  // reason this offset walk is exact rather than approximate. Every part is rendered from the
  // ORIGINAL text at its own offset, so a masked region shows the author's real characters and
  // only its TINTABILITY was decided against the mask.
  let at = 0;
  return (
    <>
      {masked.split(MENTION_TOKEN_RE).map((part, i) => {
        const raw = text.slice(at, at + part.length);
        at += part.length;
        if (!part.startsWith("@")) return <span key={i}>{raw}</span>;
        const userId = resolveMentionToken(part, memberIndex);
        const agentId =
          userId === null
            ? resolveAgentHandle(mentionHandleOf(part), agentIndex)
            : null;
        if (userId === null && agentId === null) return <span key={i}>{raw}</span>;
        // ⚠ THE WHOLE TOKEN IS TINTED, PUNCTUATION INCLUDED, and the transcript is where the two
        // deliberately differ: it re-spells a resolved agent tag as the agent's FACE, which is a
        // substitution this layer cannot make. Every character here must remain the character the
        // author typed, in the position they typed it — a mirror that edits the text it mirrors
        // is a mirror that drifts.
        return (
          <span key={i} className="text-link">
            {raw}
          </span>
        );
      })}
      {/* ⚠ A TRAILING NEWLINE NEEDS SOMETHING AFTER IT. `white-space: pre-wrap` collapses a final
          line break, so a draft ending in Enter would make the mirror one line shorter than the
          field and every scroll offset after it wrong by a line. The textarea itself does not
          collapse it, which is precisely the disagreement this closes. */}
      {text.endsWith("\n") && <span>{"​"}</span>}
    </>
  );
}
