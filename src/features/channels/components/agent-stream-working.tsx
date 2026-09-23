"use client";

/**
 * THE LIVE TAIL OF THE WORK STREAM — "Thinking" with three moving dots, at the
 * bottom of the lane, while the agent is mid-turn (Samuel's ruling, 2026-09-14).
 *
 * ⚠ IT LIVES IN THE STREAM BECAUSE THAT IS WHERE THE ANSWER WILL APPEAR. The
 * working state was already on screen — `agent-bits.tsx › AgentLiveness` in the
 * header, top right — and that is CHROME: an operator who has just sent a
 * message is reading the column their reply comes back in, and a pane that goes
 * silent there reads as an agent that did not hear them, whatever the corner of
 * the header says. This row sits under the most recent item, inside the same
 * scroller, so the thing that says "it is coming" is in the place it is coming
 * to. **It ADDS to the header pill and does not replace it.**
 *
 * ⚠ THE WORDS ARE `agents-model.ts › agentLiveness`'s, NEVER A SECOND
 * VOCABULARY. That function is the ONE mapping from a session to a word
 * ("Thinking…", "Running Bash", "Sending a message", … and "Running" when the
 * desktop reports no detail), and this row takes its label whole — so the header
 * and the stream cannot come to say two different things about one agent. All
 * this file decides is the DOTS.
 *
 * ⚠ AND IT GATES ON THE TONE HERE, NOT IN THE HOSTS. Two surfaces mount the
 * stream (the panel/Home agent view and the pop-out window); a gate written
 * twice is a gate that will one day be true in one of them, and a row reading
 * "Thinking" over a parked agent is exactly the claim this surface must never
 * make. `working` is the only tone that renders — `waiting`, `idle` and `ended`
 * render NOTHING.
 *
 * ⚠ THE DOTS ARE THE ANIMATION AND THE "…" IS NOT. `agentDetailLabel` already
 * ends its thinking case in an ellipsis CHARACTER; printed beside three animated
 * dots it is six dots in two typefaces. {@link workingRowWord} takes it off, and
 * the motion is what says "still going".
 *
 * ⚠ NO NEW KEYFRAME. Three `animate-pulse` spans on staggered delays is the
 * stagger, over Tailwind's own animation — a hand-rolled `@keyframes` would have
 * to land in BOTH stylesheets (`src/app/globals.css` and the desktop's
 * `apps/desktop-ui/src/styles/kit.css`) or animate on one host only.
 * ⚠ `motion-reduce:animate-none` LEAVES THE DOTS DRAWN, STILL — the same pairing
 * `agent-activity.tsx`'s live dot uses. Reduced motion removes the movement, not
 * the fact.
 */

import type { AgentLivenessState } from "./agents-model";

/**
 * The liveness label with its own trailing ellipsis removed — "Thinking…" →
 * "Thinking", "Running Bash" → "Running Bash".
 *
 * ⚠ EXPORTED FOR THE TEST, and the test is the point: the label is the ONE
 * mapping's, so this must stay a trim and never become a rewrite. Whatever
 * `agentLiveness` says, minus a character this row draws itself.
 */
export function workingRowWord(label: string): string {
  return label.replace(/(…|\.\.\.)\s*$/, "").trimEnd();
}

/**
 * ⚠ NOT AN `<li>`: it renders after the `<ol>`, inside the SCROLLER, so it is
 * the last thing in the column whether or not the lane has any rows yet (a
 * just-woken agent has none) — and it is not an entry in the list of things the
 * agent has done. It is what it is doing.
 * ⚠ `role="status"` so a screen reader hears the state change once; the dots are
 * `aria-hidden` decoration, and the accessible name is the word alone.
 */
export function StreamWorkingRow({
  liveness,
}: {
  /** From `agents-model.ts › agentLiveness`, or `null` when the host has no
   *  session to read. ⚠ Only `working` renders. */
  liveness?: AgentLivenessState | null;
}) {
  if (!liveness || liveness.tone !== "working") return null;
  return (
    // ⚠ FLUSH WITH THE COLUMN'S TEXT, no indent of its own: the agent's own lane
    // carries no avatar gutter (`agent-stream.tsx › AgentTurn` is plain prose),
    // so the stream's host padding is the message column's left edge and an
    // inset here would hang the row off it.
    <p
      role="status"
      className="flex min-w-0 items-center gap-1 pt-0.5 text-caption text-text-secondary"
    >
      {workingRowWord(liveness.label)}
      <span aria-hidden className="flex shrink-0 items-center gap-[3px]">
        {/* ⚠ THREE STATIC CLASS STRINGS, not a mapped identity: Tailwind reads
            the source, so a delay built at runtime generates no utility. */}
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:0ms] [animation-duration:1.4s] motion-reduce:animate-none" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:200ms] [animation-duration:1.4s] motion-reduce:animate-none" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:400ms] [animation-duration:1.4s] motion-reduce:animate-none" />
      </span>
    </p>
  );
}
