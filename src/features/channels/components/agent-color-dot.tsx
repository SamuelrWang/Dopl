/**
 * **THE COLOUR DOT** — one agent's colour, at list scale (Samuel, 2026-09-13;
 * docs/specs/agent-colors.md item 8: *"the Agents-tab card and the pop-out rail row show a
 * small colour dot before the name for live agents"*).
 *
 * ⚠ **ITS OWN FILE BECAUSE FOUR SURFACES DRAW IT AND A DOT THAT DRIFTS IS WORSE THAN NO
 * DOT.** The Agents-tab cards, the pop-out rail rows and the transcript filter's option
 * rows all answer the same question — *which agent is this* — and the whole value of the
 * answer is that the reader has already learned the hue somewhere else. Four local
 * `<span className="size-2 rounded-full">`s is four chances for one of them to end up 10px
 * or square, at which point it stops reading as the same mark.
 *
 * ⚠ **IT IS NOT THE POST'S ACCENT AND MUST NEVER GROW INTO IT.** `authored-row.tsx ›
 * AuthoredRowAccent` is the TRANSCRIPT's face — a ring around the pill and a bar down the
 * post's outer edge — and it is the only place a post's colour appears. This is a list
 * marker, and the two are separate precisely so the dot's size can change without touching a
 * single message.
 */

import { cn } from "@/shared/lib/utils";
import { agentColorVar } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";

/**
 * ⚠ **`size-2` (8px) AND NOT A LITERAL `w-[8px]`** — the tree's own sizing scale, which is
 * what docs/DESIGN-SYSTEM.md asks for and what keeps this mark in step if the scale is
 * retuned. It sits on the text baseline row of every caller, so it is sized against the
 * `text-body` line rather than given a height of its own.
 */
const DOT = "inline-block size-2 shrink-0 rounded-full";

export function AgentColorDot({
  color,
  className,
}: {
  /**
   * ⚠ **`null` RENDERS NOTHING AT ALL — NOT A GREY DOT.** Samuel scoped the colours to
   * *"agents that are currently active or are waiting"*, and a placeholder mark for "this
   * one has no colour" would put a permanent grey dot on every ended agent in a list whose
   * whole job is to make the coloured ones findable. The ONE surface that draws a grey dot
   * is the transcript filter, because there the row must stay clickable and aligned with
   * its siblings whether or not a colour is left — a different question, answered locally.
   */
  color: AgentColorKey | null;
  className?: string;
}) {
  if (!color) return null;
  return (
    <span
      /* ⚠ THE KEY AS DATA, for the tests and for a host's scoped restyle — never read back
         by this tree. The KEY rather than the resolved colour, so nothing downstream can
         start treating a hue as the identity (`authored-row.tsx` states the rule). */
      data-agent-color={color}
      /* ⚠ **`aria-hidden` AND NO LABEL, WHICH IS A DELIBERATE ACCESSIBILITY DECISION RATHER
         THAN AN OMISSION.** The dot is pure redundancy: every caller draws it immediately
         before the agent's NAME, so a screen reader that announced "green, Bug Reviewer"
         would be reading out decoration, and a reader who cannot distinguish the hues loses
         nothing — the name is the identity and the colour is only a faster route to it.
         That redundancy is also why a 16-hue palette is legitimate here at all. */
      aria-hidden
      className={cn(DOT, className)}
      style={{ backgroundColor: agentColorVar(color) }}
    />
  );
}

/**
 * 🔒 **THE COLLAPSED RAIL'S MARK — one agent's INITIAL inside a disc of that agent's colour**
 * (Samuel, 2026-09-15: *"I don't like that it just looks like letters on the black background
 * because there's nothing around it. I think we should have it be a color. Maybe it should be the
 * color of the agents, so set a thing around it to that color. That's the color of the agents."*).
 *
 * ⚠ **IT LIVES HERE AND NOT IN THE RAIL FOR {@link AgentColorDot}'s OWN REASON** — this file is
 * where a key becomes a list mark, and a second local `rounded-full` painted from `agentColorVar`
 * is exactly the drift that argument is about. Two scales of one mark: the 8px dot beside a name,
 * this disc when the name is gone.
 *
 * ⚠ **THE DISC IS `size-5` (20px), WHICH IS THE PALETTE'S OWN CIRCLE STEP** —
 * `agent-color-circles.tsx › CIRCLE` is `h-5 w-5`. On the tree's spacing scale, not an arbitrary
 * `w-[20px]`, and it sits inside the rail's 36px `TILE` with room for the selected row's tint.
 *
 * ⚠ **THE INK IS `--text-on-cta`, THE APP'S ONE ON-DARK TOKEN** — `attribution-pill.tsx ›
 * AgentChip` states the rule (*"not `text-white`: a literal white is a colour a restyle cannot
 * follow"*), and it is safe across the WHOLE bank rather than per hue: all sixteen
 * `--agent-color-NN` values are `oklch(0.44 …)`, one lightness, so one on-colour ink is correct
 * for every key by construction.
 */
const INITIAL_DISC =
  "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-medium leading-none";

export function AgentColorInitial({
  color,
  initial,
  className,
}: {
  /**
   * ⚠ **`null` KEEPS THE LETTER AND DROPS THE DISC — it does NOT render nothing.** That is the
   * opposite of {@link AgentColorDot}'s rule and the difference is what the mark is FOR: a dot is
   * redundant decoration beside a name the reader can already see, so an uncoloured one is noise;
   * this letter is the ONLY thing identifying the row in a collapsed rail, so an agent with no
   * colour must still be recognisable and clickable. Same box either way, so nothing shifts when
   * a key arrives.
   */
  color: AgentColorKey | null;
  /** Already reduced to one character by the caller — the rail owns its `#` handling. */
  initial: string;
  className?: string;
}) {
  return (
    <span
      /* ⚠ THE KEY AS DATA, never read back by this tree — {@link AgentColorDot}'s own precedent,
         and it is what lets the rail's suite assert WHICH agent this disc belongs to. */
      data-agent-color={color ?? undefined}
      /* ⚠ **`aria-hidden`, AND THE CALLER OWES THE NAME.** A single letter is not a name, and an
         un-hidden one would OUTRANK the button's `title` in the accessible-name computation —
         turning a rail of agents into a list of alphabet. */
      aria-hidden
      className={cn(
        INITIAL_DISC,
        color ? "text-text-on-cta" : "text-text-secondary",
        className
      )}
      style={color ? { backgroundColor: agentColorVar(color) } : undefined}
    >
      {initial}
    </span>
  );
}
