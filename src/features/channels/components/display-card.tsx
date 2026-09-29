"use client";

/**
 * **THE DISPLAY CARD — every display an agent shows, and every decision** (docs/specs/
 * unified-display.md §7.3). A decision IS a display with a `choice` block; old decision rows
 * (`metadata.escalation` only) and v1 glasses displays arrive here through the one read-time
 * adapter (`display/core/adapt.ts › displayOf`), so there is one card and no second face.
 *
 * Hosts: `transcript.tsx` (inside `AuthoredRow`: the channels page, the desktop workspace pages and
 * the /home pane) at the `row` step, and `agent-stream.tsx` at the `stream` step.
 *
 * ⚠ **THE SHELL IS THE DECISION CARD'S** (`escalation-card-face.ts › AGENT_CARD_FACE`): the bar in
 * the posting agent's paint (black when ended), the white panel inset under it. The bar says
 * `Needs Your Decision` when the display has a choice, else `Display`.
 *
 * ⚠ **LIVE BY CONSTRUCTION.** A replace rewrites the SAME message's `metadata.display`; the
 * transcript's re-read redraws this card, which holds no copy of the blocks — only the press in
 * flight.
 */

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { choiceOf, type Display } from "@/features/display/core/types";
import { useDisplaySave, type AnswerDisplay } from "../hooks/use-display-writes";
import { DisplayBlocks } from "./display-blocks";
import { DisplayChoice, isDecisionFace } from "./display-choice";
import {
  AGENT_CARD_FACE,
  DECISION_CARD_LABEL,
  type AgentCardSize,
} from "./escalation-card-face";

export const DISPLAY_CARD_LABEL = "Display";
export const DISPLAY_REPLACED_LABEL = "Replaced";

/** What a host knows about a display beyond its blocks — built once in the view model. */
export interface DisplayView {
  display: Display;
  /** The viewer is in `answerersOf` (tagged, else the author account) — the server's 403 rule. */
  answerable: boolean;
  /** "You" / the answerer's name, when the answer can say who. */
  answeredBy: string | null;
  /** Save as template is offered (the viewer's own agent's display, not a legacy decision). */
  saveable: boolean;
}

export function DisplayCard({
  channelId,
  messageId,
  view,
  paint,
  size = "row",
  onAnswer,
}: {
  channelId: string;
  messageId: string;
  view: DisplayView;
  /** `escalation-card-face.ts › decisionCardPaint` of the posting agent. */
  paint: string;
  size?: AgentCardSize;
  /** The host's answer write; ABSENT draws no buttons anywhere (absent-not-disabled). */
  onAnswer?: AnswerDisplay;
}) {
  const { display } = view;
  const face = AGENT_CARD_FACE[size];
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const choice = choiceOf(display.blocks);
  // Withdrawn by a newer message (`superseded_by`): closed, read-only, never answerable.
  const closed = !!display.superseded_by;
  const choose =
    choice && view.answerable && onAnswer && !display.answer && !closed
      ? async (index: number) => {
          setPendingIndex(index);
          if (!(await onAnswer({ channelId, messageId, index }))) setPendingIndex(null);
        }
      : undefined;
  return (
    <div
      data-display-id={display.display_id || undefined}
      data-escalation-id={display.decision ? messageId : undefined}
      data-superseded={closed || undefined}
      className={face.shell}
      style={{ backgroundColor: paint }}
    >
      <div className={face.bar}>
        <span className={cn(face.barType, "flex-1")}>
          {choice ? DECISION_CARD_LABEL : DISPLAY_CARD_LABEL}
        </span>
        {view.saveable && <SaveButton channelId={channelId} messageId={messageId} />}
      </div>
      <div className={face.panel}>
        <DisplayBlocks
          display={display}
          face={face}
          choice={
            choice && (
              <DisplayChoice
                choice={choice}
                decisionFace={isDecisionFace(choice, display.from === "escalation")}
                answer={display.answer}
                answeredBy={view.answeredBy}
                pendingIndex={pendingIndex}
                face={face}
                onChoose={choose}
              />
            )
          }
        />
        {closed && <p className="text-caption text-text-muted">{DISPLAY_REPLACED_LABEL}</p>}
      </div>
    </div>
  );
}

function SaveButton({ channelId, messageId }: { channelId: string; messageId: string }) {
  const writes = useDisplaySave(channelId, messageId);
  return (
    <button
      type="button"
      disabled={writes.busy || writes.saved}
      onClick={() => void writes.save()}
      className="shrink-0 text-caption font-medium text-text-on-cta/80 transition-colors hover:text-text-on-cta disabled:cursor-default"
    >
      {writes.saved ? "Saved" : "Save"}
    </button>
  );
}
