"use client";

/**
 * Channels v2 — **THE COLOURED BOX A CHANNEL AGENT'S POST WEARS** (Samuel,
 * 2026-09-13; docs/specs/agent-colors.md).
 *
 * His words: *"for each message that the agent sends in that channel, I want a
 * specialized UI where it has a border line around that message from that agent in
 * that specific color. There is a top bar, similar to the posted channel bar, that is
 * that color. The pill for that agent is now moved to the left so that it's in the bar
 * but on the left side of the bar. … For desktop agents and for messages from users,
 * keep those white and without any box."*
 *
 * ── ⚠ WHAT THIS FILE IS NOT ────────────────────────────────────────────────────────
 *
 * ⚠ **IT IS NOT A SECOND `AuthoredRow` AND IT DOES NOT FORK THE PILL.** The frame is
 * the only new thing: the pill is `attribution-pill.tsx › AttributionPill` unchanged
 * (Samuel's *"the pill's own recipe, unchanged"*), the body is the caller's children,
 * and the side/continuation/flash rules stay in `authored-row.tsx`, which is where
 * INVARIANTS §5's `authorUserId === currentUserId` rule lives. A boxed row that
 * re-derived any of that would be a second place to fix the next side bug.
 *
 * ⚠ **AND IT DECIDES NOTHING ABOUT WHO GETS A BOX.** That predicate is one place —
 * `agent-box-rule.ts › agentBoxOf` — because the filter dropdown
 * (`transcript-filter.tsx`) has to ask the SAME question about the same row and get
 * the same answer, and Samuel defined "People" as *"all of the messages that don't
 * have a colored box around them"*. Two spellings of "is this boxed" is that filter
 * silently disagreeing with the paint.
 *
 * ── ⚠ THE COLOUR IS A CSS VARIABLE REFERENCE IN AN INLINE `style`, AND THAT IS THE
 *    DESIGN SYSTEM'S RULE HONOURED RATHER THAN BENT ────────────────────────────────
 *
 * docs/DESIGN-SYSTEM.md forbids a hardcoded colour in a component; it does not
 * forbid an inline style, and here the two pull in opposite directions. The palette
 * member is chosen by DATA (a key off a peer's projection), and a Tailwind class
 * cannot be built from a runtime key — `bg-[var(--agent-color-${key})]` is a dynamic
 * class name the JIT never sees, so the honest alternatives are sixteen literal
 * classes per property, a safelist, or this. `lib/agent-colors.ts › agentColorVar` is
 * the ONLY place the token name is spelled, every value stays in the two CSS palettes,
 * and no colour appears in this file at all.
 *
 * ⚠ **THE BODY IS WHITE AND THE BAR CARRIES THE WHOLE HUE** (the ruling: *"the body
 * below on white"*). No tint, no `-soft` companion token, and `--surface` rather than
 * a literal — a 16-hue tinted fill behind real prose is sixteen different contrast
 * ratios against one text colour, and the one thing every transcript body must keep is
 * readability.
 */

import { cn } from "@/shared/lib/utils";
import { agentColorVar } from "../../lib/agent-colors";
import { AttributionPill } from "./attribution-pill";
import type { AgentColorKey } from "../../types";
import type { MessageRow } from "./view-model-rows";

/**
 * THE BAR'S GEOMETRY, SHARED WITH THE POP-OUT'S "posted to channel" BANNER BY
 * REFERENCE RATHER THAN BY COINCIDENCE (Samuel: *"a top bar, similar to the posted
 * channel bar"*).
 *
 * ⚠ **IT LIVES HERE AND `agent-stream-sent-box.tsx` IMPORTS IT**, not the other way
 * round, and the direction is deliberate: that file is the OUTBOUND CONSENT card and
 * moves when §6 moves, while this one moves when the colour rule moves — and the bar
 * is now the colour rule's. The two surfaces must stay the same height or *"similar
 * to"* becomes a thing a reader can measure and find false.
 *
 * ⚠ NO `rounded` OF ITS OWN: the frame's `overflow-hidden` clips this bar to the
 * frame's radius, so a second radius here would fight the first and leave a hairline
 * of body colour in each top corner.
 */
export const AGENT_BAR = "flex items-center gap-1.5 px-2.5 py-[5px]";

/**
 * **THE FRAME.** A 2px border and a full-width bar, both in one colour.
 *
 * ⚠ **2px AND NOT 1px, WHICH IS THIS TREE'S USUAL BORDER** — at 1px a mid-chroma hue
 * against white is a hairline a reader has to hunt for, and telling two agents apart
 * at a glance is the entire feature. It is also the reason the bar exists rather than
 * a border alone.
 *
 * ⚠ `rounded-[14px]` IS THE RULING'S NUMBER and is two larger than the pop-out card's
 * 12: this frame carries a 2px border where that one carries 1px, so matching the
 * outer radii would leave the INNER corner tighter and read as a squarer box.
 */
const FRAME = "min-w-0 overflow-hidden rounded-[14px] border-2 bg-surface";

/**
 * **AN ENDED AGENT'S BOX** — the token, not a colour (the ruling: *"ended → neutral
 * `--border-strong`"*).
 *
 * ⚠ **IT IS A BOX AND NOT A BARE ROW, WHICH IS THE POINT OF HAVING A NEUTRAL FACE AT
 * ALL.** A colour goes back to the bank when its agent ends, so an ended agent's posts
 * CANNOT keep their hue — but they are still agent posts, and dropping the frame
 * entirely would make them read as a person's (*"For desktop agents and for messages
 * from users, keep those white and without any box"* is a rule about AUTHOR, never
 * about liveness). Neutral says "an agent, not here any more"; nothing says that.
 */
const NEUTRAL = "var(--border-strong)";

export function MessageBoxAgent({
  row,
  color,
  agentName,
  onOpenAgent,
  flash,
  children,
}: {
  row: MessageRow;
  /**
   * THE KEY, or `null` for the neutral face.
   *
   * ⚠ **`null` COVERS THREE DIFFERENT FACTS AND DRAWS ONE THING**: the agent ENDED
   * (its key is back in the bank), no key was ever assigned (a desktop older than this
   * wave, or a room with all sixteen out), or the projection reported something outside
   * the set. `lib/agent-colors.ts › agentColorOrNull` collapses all three upstream, and
   * a reader cannot tell them apart in any case — a fourth face for "the bank was full"
   * would be chrome about the room's bookkeeping.
   */
  color: AgentColorKey | null;
  /** Resolved by the caller off `AuthorIndex.agents`, exactly as `AuthoredRow` takes
   *  it — this component owns no index either. */
  agentName: string | null;
  /** Already gated by the caller. Absent leaves the pill inert. */
  onOpenAgent?: () => void;
  flash: boolean;
  children: React.ReactNode;
}) {
  const paint = color ? agentColorVar(color) : NEUTRAL;
  return (
    <article
      data-message-id={row.id}
      /* ⚠ THE KEY IS ON THE DOM AS DATA, AND IT IS FOR THE TESTS AND FOR A HOST'S
         SCOPED RESTYLE — never read back by this tree. `data-attribution-pill`'s
         precedent (attribution-pill.tsx): a stable hook carries no meaning. It is the
         KEY rather than the resolved colour, so nothing downstream can start treating
         a hue as the identity. */
      data-agent-color={color ?? undefined}
      className={cn(
        // ⚠ THE NEGATIVE MARGIN PAIR IS `AuthoredRow`'s, kept so a boxed row and a
        // bare one occupy the same strip and the transcript does not step in and out
        // as authors alternate.
        "-mx-2 my-0.5 px-2 transition-colors duration-700",
        flash && "duration-150"
      )}
    >
      {/* ⚠ **ONE POST, ONE BOX — A RUN BY ONE AGENT DOES NOT MERGE** (the ruling:
          *"Consecutive posts by the same agent do NOT merge boxes"*), so this frame
          does NOT consult `row.continuation` and must never learn to. A merged box
          would have to drop the bar for the second post, and the bar is where the
          attribution and the time are: the reader would lose the timestamp on every
          message after the first, which is exactly what the bare transcript's
          continuation rule can afford and a delivery record cannot. */}
      <div className={FRAME} style={{ borderColor: paint }}>
        <div className={AGENT_BAR} style={{ backgroundColor: paint }}>
          {/* ⚠ **THE PILL, ON THE LEFT, AND NOTHING ON THE RIGHT** (the ruling, in
              those words). It carries the avatar, the name and the TIME already, which
              is why the right side is deliberately empty rather than holding a second
              stamp: the pop-out's banner puts its timestamp there because its label is
              a sentence and not a pill. */}
          <AttributionPill
            author={row.author}
            authorLabel={row.authorLabel}
            agent={row.agent}
            agentId={row.agentId}
            agentName={agentName}
            time={row.time}
            onOpenAgent={onOpenAgent}
          />
        </div>
        {/* ⚠ THE BODY COLUMN IS NEVER `items-end`. A boxed row is an AGENT's, and
            INVARIANTS §5 puts agent posts on the peer side by definition, so the
            `mine` axis `AuthoredRow` carries has no case to answer here — hard-coding
            the start alignment is narrower than passing a side this frame could get
            wrong. */}
        <div className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">{children}</div>
      </div>
    </article>
  );
}
