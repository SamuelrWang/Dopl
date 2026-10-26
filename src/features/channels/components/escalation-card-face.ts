/**
 * The agent card's face: every display an agent shows, decisions included (docs/specs/
 * unified-display.md §7.3). `display-card.tsx` draws it in the transcript (`row`) and in the agent
 * stream (`stream`, one notch smaller); the tag's words, the paint rule and both size steps live
 * here.
 */

import { agentColorVar } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";

/** The tag on a display with a choice: the reader's job. */
export const DECISION_CARD_LABEL = "Needs your decision";
export const DISPLAY_CARD_LABEL = "Display";

/**
 * The tag's paint: the posting agent's colour, else ink (`--surface-cta`) once it has ended or was
 * never coloured. Ink, not the row accent's `--border-strong`: the tag carries white type.
 */
export function decisionCardPaint(color: AgentColorKey | null | undefined): string {
  return color ? agentColorVar(color) : "var(--surface-cta)";
}

export type AgentCardSize = "row" | "stream";

export interface AgentCardFace {
  shell: string;
  /** The content-width tag in the agent's paint. */
  tag: string;
  /** A heading block: on a decision, the question. */
  heading: string;
  /** Every other body line. */
  body: string;
  /** Text blocks beside a choice: why the reader is asked. */
  context: string;
  options: string;
  /** One option row's box. */
  option: string;
  optionLabel: string;
  /** The consequence and the recommendation's why. */
  optionNote: string;
}

export const AGENT_CARD_FACE: Record<AgentCardSize, AgentCardFace> = {
  row: {
    shell: "white-card mt-1 flex w-full max-w-[460px] flex-col gap-2 rounded-[14px] p-3 text-left",
    tag: "rounded-full px-2.5 py-[3px] text-caption font-semibold text-text-on-cta",
    heading: "wrap-anywhere text-heading font-medium text-text-primary",
    body: "wrap-anywhere text-body text-text-primary",
    context: "wrap-anywhere text-small text-text-tertiary",
    options: "flex flex-col gap-1.5 pt-0.5",
    option: "gap-0.5 rounded-[10px] px-[11px] py-[9px]",
    optionLabel: "text-small",
    optionNote: "text-caption",
  },
  stream: {
    shell: "white-card flex flex-col gap-1.5 rounded-[12px] p-2.5 text-left",
    tag: "rounded-full px-2 py-px text-micro font-semibold text-text-on-cta",
    heading: "wrap-anywhere text-body font-medium text-text-primary",
    body: "wrap-anywhere text-caption text-text-primary",
    context: "wrap-anywhere text-caption text-text-tertiary",
    options: "flex flex-col gap-1",
    option: "gap-px rounded-[8px] px-2.5 py-1.5",
    optionLabel: "text-caption",
    optionNote: "text-micro",
  },
};
