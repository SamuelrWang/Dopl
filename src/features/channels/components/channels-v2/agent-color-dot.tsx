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
 * ⚠ **IT IS NOT THE BOX AND MUST NEVER GROW INTO IT.** `message-box-agent.tsx` is the
 * TRANSCRIPT's face — a frame, a bar and a pill — and it is the only place a post's colour
 * appears. This is a list marker, and the two are separate precisely so the dot's size can
 * change without touching a single message.
 */

import { cn } from "@/shared/lib/utils";
import { agentColorVar } from "../../lib/agent-colors";
import type { AgentColorKey } from "../../types";

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
         start treating a hue as the identity (`message-box-agent.tsx` states the rule). */
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
