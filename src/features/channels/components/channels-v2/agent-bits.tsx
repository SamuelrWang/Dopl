"use client";

/**
 * Channels v2 — the two pieces that state WHAT AN AGENT IS: its liveness and its
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

import { cn } from "@/shared/lib/utils";
import type { AgentLivenessState, AgentLivenessTone } from "./agents-model";

/**
 * LIVENESS of one agent — a dot and a word, no pill chrome.
 *
 * Deliberately NOT `StatusPill`: that bordered green pill is the channel's
 * settled "Active" state and would out-shout the agent label beside it. The word
 * carries the state for anyone the colour does not reach.
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
 */
export function AgentEndedPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[6px] bg-surface-cta px-2 py-px text-micro font-medium text-text-on-cta",
        className
      )}
    >
      Ended
    </span>
  );
}