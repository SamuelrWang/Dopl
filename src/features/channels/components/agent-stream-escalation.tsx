"use client";

/**
 * Channels — THE DECISION CARD, AS THE AGENT STREAM DRAWS IT.
 *
 * ⚠ THERE ARE TWO ROW PIPELINES AND THIS IS THE SECOND ONE. The channel and
 * thread transcripts share `view-model-rows.ts` → `transcript.tsx` →
 * `authored-row.tsx`; the agent stream has its own union (`agent-stream-model.ts
 * › StreamItem`), its own builder and its own dispatch, and mounts NO
 * `AuthoredRow`. A card that exists in one and not the other is the "where did
 * my question go" report, so it is implemented twice, on purpose, and the two
 * are held together by `escalation-agent-stream.test.tsx`.
 *
 * ⚠ **AND SINCE THE 2026-09-20 RESTYLE THE FACE ITSELF IS SHARED**
 * (`escalation-card-face.ts`): the bar's words, the "Option A" naming, the paint
 * rule and the three button skins are one spelling for both files, so the only
 * thing that differs here is the SIZE STEP. Two copies of the words is how one
 * card came to look like two.
 *
 * ⚠ FULL STREAM WIDTH, NOT A CHAT BUBBLE — `agent-stream.tsx ›
 * SentToChannelBox`'s own rule, and this is the same KIND of thing: a record of
 * something the agent SENT, rendered where the operator is watching it work.
 * The stream has no sides, no avatars and no attribution pills to fit into.
 *
 * ⚠ IT IS THE OPERATOR'S OWN AGENT, ALWAYS. This surface is one machine's own
 * registry (`agents-model.ts`'s header), so a card here was written by an agent
 * the viewer runs — which is exactly the case where the untagged fallback makes
 * them the answerer. The `answerable` flag still gates the buttons, because a
 * tagged escalation may have named somebody else.
 */

import { cn } from "@/shared/lib/utils";
import {
  DECISION_BTN_BASE,
  DECISION_BTN_BLACK,
  DECISION_BTN_GREY,
  DECISION_CARD_LABEL,
  decisionCardPaint,
  decisionOptionName,
} from "./escalation-card-face";
import type { ChannelEscalation } from "../escalation";
import type { AgentColorKey } from "../types";

/** The stream's type steps — one notch under the transcript card's, which is
 *  the only licensed difference between the two faces. */
const BAR_TYPE = "text-caption font-semibold leading-tight text-text-on-cta";
const BODY_TYPE = "wrap-anywhere text-caption text-text-primary";
const BTN_BOX = "h-[24px] px-2.5 text-micro";

export function AgentStreamEscalation({
  escalation,
  color = null,
  answerable,
  answeredIndex,
  busy,
  onAnswer,
}: {
  escalation: ChannelEscalation;
  /**
   * **THIS AGENT'S OWN COLOUR — the bar's paint** (Samuel, 2026-09-20).
   *
   * ⚠ **HANDED DOWN, NEVER LOOKED UP.** The stream's group already resolves the
   * key for the sent lane (`agent-stream.tsx › StreamGroupRow`'s `color`), and a
   * second read here would be a second source for one agent's hue. `null` —
   * unassigned, or a bank that was full — paints black, which is the card's
   * pre-restyle face.
   */
  color?: AgentColorKey | null;
  /** This viewer is one of the members the escalation asked. */
  answerable: boolean;
  /** Which option was already chosen, or `null` — "not in this page", never
   *  "unanswered" (the transcript page is bounded). */
  answeredIndex: number | null;
  busy: boolean;
  /**
   * ⚠ ABSENT RENDERS NO BUTTONS AT ALL, never disabled ones — the
   * absent-not-disabled rule this whole family follows. The pop-out agent window
   * mounts this stream with no write path and lands here.
   */
  onAnswer?: (optionIndex: number) => void;
}) {
  const canAnswer = answerable && !!onAnswer && answeredIndex === null;
  const answered = answeredIndex !== null;
  return (
    <div
      data-agent-escalation
      className="overflow-hidden rounded-[12px]"
      style={{ backgroundColor: decisionCardPaint(color) }}
    >
      <div className="flex items-center px-2.5 py-1.5">
        <span className={BAR_TYPE}>{DECISION_CARD_LABEL}</span>
      </div>
      <div className="m-0.5 mt-0 flex flex-col gap-1.5 rounded-[10px] bg-white p-2.5">
        <p className={BODY_TYPE}>{escalation.issue}</p>
        {escalation.context && (
          <p className={cn(BODY_TYPE, "whitespace-pre-wrap")}>{escalation.context}</p>
        )}
        <ul className="flex flex-col gap-0.5">
          {escalation.options.map((option, i) => (
            <li key={i} className={BODY_TYPE}>
              <span className="font-medium">{decisionOptionName(i)}</span>
              {" — "}
              <span>{option.label}</span>
              {option.consequence && (
                <>
                  {": "}
                  <span>{option.consequence}</span>
                </>
              )}
            </li>
          ))}
        </ul>
        {escalation.recommendation && (
          <p className={BODY_TYPE}>
            <span className="font-medium">
              Recommended: {decisionOptionName(escalation.recommendation.index)}
            </span>
            {escalation.recommendation.why && (
              <>
                {" — "}
                <span>{escalation.recommendation.why}</span>
              </>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {escalation.options.map((option, i) => {
            const chosen = answeredIndex === i;
            const face = cn(
              DECISION_BTN_BASE,
              BTN_BOX,
              answered ? (chosen ? DECISION_BTN_BLACK : DECISION_BTN_GREY) : DECISION_BTN_BLACK
            );
            if (!canAnswer) {
              return (
                <span key={i} data-option-index={i} className={face}>
                  {decisionOptionName(i)}
                </span>
              );
            }
            return (
              <button
                key={i}
                type="button"
                disabled={busy}
                data-option-index={i}
                aria-label={`${decisionOptionName(i)}: ${option.label}`}
                onClick={() => onAnswer?.(i)}
                className={cn(face, "disabled:opacity-60")}
              >
                {decisionOptionName(i)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
