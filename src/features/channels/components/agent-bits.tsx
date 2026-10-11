"use client";

/**
 * Channels — the two pieces that state WHAT AN AGENT IS: its liveness and its
 * Ended badge.
 *
 * ⚠ SPLIT OUT OF `bits.tsx` ON 2026-08-22, and not for the line count: these two
 * render a verdict from `agents-model.ts › agentLiveness`, so leaving them in the
 * shared primitives layer pointed it at a feature model and made every
 * agent-state change a change to the file every column imports.
 *
 * ⚠ NEITHER OF THEM DECIDES ANYTHING. `agentLiveness` is the ONE mapping — four
 * states, one table, every surface — and this file is where its answer becomes
 * ink. A second opinion about what "idle" means is the two-readers-one-fact
 * defect, and a status word is exactly where it goes unnoticed.
 */

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import type { AgentLivenessState, AgentLivenessTone } from "./agents-model";
import { agentColorVar } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";

/**
 * LIVENESS of one agent — a dot and a word, no pill chrome.
 *
 * Deliberately NOT A BORDERED PILL: the channel Info tab carried one for its
 * settled "Active" state (`bits.tsx › StatusPill`, deleted with the archive
 * feature on 2026-09-17), and that chrome would out-shout the agent label beside
 * it. The word carries the state for anyone the colour does not reach.
 *
 * ⚠ IT RENDERS A VERDICT; IT DOES NOT MAKE ONE. The `tone`/`label` pair is
 * `agents-model.ts › agentLiveness`'s (2026-08-22); it took a `running` boolean
 * until then, which is why "alive between turns" and "parked" both had to render
 * as "Idle".
 *
 * ⚠ FOUR TONES, AND THE TWO QUIET ONES DIFFER ON PURPOSE. `waiting` is ALIVE — a
 * filled dot in muted ink — while `idle` hollows the dot out, because "will
 * answer the moment something arrives" and "is not running" should not be one
 * picture. `ended` is the most muted: a record, not a state anything will leave.
 */
const LIVENESS_TONE: Record<
  AgentLivenessTone,
  { text: string; dot: string }
> = {
  working: { text: "text-success", dot: "bg-success" },
  waiting: { text: "text-text-secondary", dot: "bg-text-secondary" },
  idle: { text: "text-text-muted", dot: "border border-text-disabled" },
  ended: { text: "text-text-disabled", dot: "border border-text-disabled" },
};

export function AgentLiveness({
  tone,
  label,
  className,
}: AgentLivenessState & { className?: string }) {
  const face = LIVENESS_TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-caption font-medium",
        face.text,
        className
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", face.dot)} />
      {label}
    </span>
  );
}

/**
 * **THE PILL'S GEOMETRY WITHOUT ITS FILL** — the shape, the padding and the type, and no
 * statement about what colour it is (extracted 2026-10-10, #3081).
 *
 * ⚠ **IT EXISTS BECAUSE ONE SURFACE NEEDS THIS PILL ON A DARK BANNER, WHERE THE BLACK FILL
 * IS INVISIBLE.** The agent stream's outbound box names the post's addressees as pills in
 * its own top bar (Samuel: *black pills naming who it was addressed to*), and that bar is
 * already `--surface-cta` — or the agent's own colour, which is a dark ramp
 * ({@link AgentPill}'s `color`). {@link AGENT_PILL_FACE} rendered there is a black
 * pill on a black strip: the shape Samuel asked for, drawn so it cannot be read.
 * ⚠ **SO THE DARK-BANNER CASE TAKES THE SHAPE AND SUPPLIES ITS OWN INK**
 * (`agent-stream-sent-box.tsx › BANNER_PILL`), and there is still exactly one place the
 * geometry is written. Copying four utilities into that file instead is the drift this
 * module's header is about.
 *
 * 🔒 **`shrink-0` IS PART OF THE SHAPE AND A CALLER MAY OVERRIDE IT — STATED HERE, ONCE**
 * (consolidated in the release review, 2026-10-11). `cn` is `tailwind-merge`, so a LATER
 * `shrink` in the same `cn(...)` call wins over this `shrink-0`: a pill that refuses to
 * shrink is CLIPPED by a parent's `truncate` with no `…` instead of eliding, and three
 * pills on a 380px recipient line or banner have to elide. The argument used to be written
 * out in full at all three call sites — `agent-activity.tsx`, `agent-stream-sent-box.tsx ›
 * BANNER_PILL` and here — which is three copies of one fact about THIS constant. They now
 * point at this note; the override itself is unchanged at every one of them.
 */
export const AGENT_PILL_SHAPE =
  "shrink-0 rounded-[6px] px-2 py-px text-micro font-medium";

/**
 * **THE PILL'S FOUR UTILITIES, AS A STRING** — so a surface that needs the FACE but
 * cannot hand {@link AgentPill} its `color` as a KEY still wears one recipe.
 *
 * ⚠ **IT EXISTS FOR THE WORKING STRIP, AND ONLY BECAUSE OF WHO RESOLVES THE PAINT**
 * (2026-10-10). `agent-activity.tsx` is handed each agent's colour ALREADY RESOLVED
 * to a `var(--agent-color-NN)` string by its host — `channel-surface.tsx` states that
 * rule, Samuel-attributed, and *"no colour reaches the component as a key"* — so it
 * cannot call {@link AgentPill}, whose `color` prop is a key it spells itself. The
 * alternatives were to flip that host contract or to copy these four utilities into
 * a second file and let the two drift. This is the third, and it is the same move
 * {@link AgentPill} itself was extracted by.
 * ⚠ **IT IS {@link AGENT_PILL_SHAPE} PLUS THE CTA FILL — THE SAME CLASS SET, AND THE
 * ORDER IS THE ONE THING THAT MOVED** when the shape was split out (the two fill
 * utilities are now last rather than mid-string). Nothing reads it as a literal, and the
 * classes do not conflict with each other, so `cn`/tailwind-merge resolves the pair
 * exactly as before. No caller moved and the ordinary black pill is still the default
 * everywhere: that was a split, not a widening.
 */
export const AGENT_PILL_FACE = `${AGENT_PILL_SHAPE} bg-surface-cta text-text-on-cta`;

/**
 * THE BLACK PILL'S FACE, and nothing about what it MEANS (extracted 2026-09-15).
 *
 * ⚠ **IT EXISTS BECAUSE A SECOND SURFACE NEEDED THE FACE AND NOT THE WORD.** The
 * Mentions inbox names the AGENT that tagged you in this same pill (Samuel:
 * *"black pill, styled exactly like the ended pill"*), and there were only two
 * ways to get it: render `AgentEndedPill` with a label that is not an ending —
 * a component whose name would then be a lie at every call site — or copy four
 * utility classes into another file and let the two drift. This is the third.
 *
 * ⚠ **IT DECIDES NOTHING AND SAYS NOTHING.** No default label, no state, no
 * vocabulary: callers bring the words, exactly as they already did here.
 */
export function AgentPill({
  children,
  color = null,
  className,
}: {
  children: ReactNode;
  /**
   * **THAT AGENT'S IDENTITY COLOUR, WORN AS THE PILL'S FILL** (Samuel,
   * 2026-09-15: *"have the black pill be in the color of that agent"*).
   *
   * ⚠ **`null` IS THE BLACK ONE, AND IT IS NOT A FALLBACK FOR A FAILURE.** The
   * Agents-tab ended pill has no agent colour to wear and must not acquire one —
   * an ENDED agent is deliberately uncoloured everywhere (`agent-color-dot.tsx`
   * states that rule) — and a live agent in a room whose sixteen keys are all out
   * runs uncoloured too. Both are ordinary, both get the CTA face.
   * ⚠ **THE INK DOES NOT MOVE.** `--agent-color-NN` is a dark ramp (L 0.44), the
   * same one the transcript already puts white on, so `text-text-on-cta` reads on
   * either fill and there is no second ink rule to keep in step.
   */
  color?: AgentColorKey | null;
  className?: string;
}) {
  return (
    <span
      className={cn(AGENT_PILL_FACE, className)}
      // ⚠ A CSS VARIABLE, NOT A CLASS: the sixteen keys are runtime data off
      // `channel_sessions.color`, so a Tailwind class per key could not be
      // statically extracted and would ship as sixteen dead rules.
      style={color ? { backgroundColor: agentColorVar(color) } : undefined}
    >
      {children}
    </span>
  );
}

/**
 * ENDED — the badge an agent wears beside its ID once it is over (Samuel,
 * 2026-08-22).
 *
 * ⚠ IT IS A RECORD, NOT A STATE. An ended agent is DEAD: every wake path refuses
 * and nothing revives it, but what it POSTED stays in the channel forever — which
 * is why the card has to say so. A reader who sees its messages, its card and no
 * marker cannot tell a finished agent from a quiet one.
 *
 * ⚠ IT REPLACES THE LIVENESS ELEMENT ON THE ROW RATHER THAN JOINING IT. A pill
 * reading "Ended" beside a dot reading "Ended" is one fact said twice, and a
 * redundant pair drifts.
 *
 * ⚠ **IT SAT ABOVE {@link AGENT_PILL_SHAPE} UNTIL THE 2026-10-11 RELEASE REVIEW**, three
 * docblocks deep in a stack where only the last one attached to anything — so the two
 * pill recipes were documented by each other's notes and this component by none. Moved,
 * not reworded.
 */
export function AgentEndedPill({
  label = "Ended",
  className,
}: {
  /**
   * 🔒 **THE WORDS, WHEN THE SURFACE HAS FULLER ONES** (Samuel, 2026-09-15, over the pop-out:
   * *"You see 'Ended by you.' Have 'Ended by you' be that black badge, right? 'Ended by you'
   * should be the badge."*).
   *
   * ⚠ **THE DEFAULT IS THE ONLY THING THE LIST SURFACES MAY SAY, AND IT IS WHY THIS IS A PROP
   * RATHER THAN A SECOND PILL.** An Agents-tab card and the slide-out header know only
   * `state === "ended"`; the agent WINDOW additionally has main's own sentence for WHICH end it
   * was (`main/session-effects.js › endedStatusText` — "Ended by you", "Ended after going
   * inactive", "Ended because a person joined this channel", "Ended after being left parked").
   * One face, two amounts of knowledge — not two faces.
   * ⚠ **THIS FILE STILL DECIDES NOTHING.** The wording arrives already chosen, exactly as
   * {@link AgentLiveness}'s does: a second table mapping an end REASON to words is the
   * two-readers-one-fact defect this module's header is about.
   */
  label?: string;
  className?: string;
}) {
  // ⚠ THE FACE IS {@link AgentPill}'s since 2026-09-15 — one recipe, two meanings.
  // What is left here is the WORDING rule, which is all this component ever owned.
  return <AgentPill className={className}>{label}</AgentPill>;
}