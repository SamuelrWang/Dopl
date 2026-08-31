"use client";

/**
 * Channels v2 — THE ESCALATION CARD, AS THE AGENT STREAM DRAWS IT.
 *
 * ⚠ THERE ARE TWO ROW PIPELINES AND THIS IS THE SECOND ONE. The channel and
 * thread transcripts share `view-model-rows.ts` → `transcript.tsx` →
 * `authored-row.tsx`; the agent stream has its own union (`agent-stream-model.ts
 * › StreamItem`), its own builder and its own dispatch, and mounts NO
 * `AuthoredRow`. A card that exists in one and not the other is the "where did
 * my question go" report, so it is implemented twice, on purpose, and the two
 * are held together by `escalation-agent-stream.test.tsx`.
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
import { AlertCircle, Check } from "lucide-react";
import type { ChannelEscalation } from "../../escalation";

/** ⚠ THE SAME WORDS THE TRANSCRIPT CARD'S BAR CARRIES. Two spellings of one
 *  label is how one question comes to look like two different things. */
const CARD_LABEL = "Needs a decision";

export function AgentStreamEscalation({
  escalation,
  answerable,
  answeredIndex,
  busy,
  onAnswer,
}: {
  escalation: ChannelEscalation;
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
  return (
    <div
      data-agent-escalation
      className="overflow-hidden rounded-[12px] bg-surface-cta ring-1 ring-surface-cta"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <AlertCircle size={12} aria-hidden className="shrink-0 text-text-on-cta" />
        <span className="text-micro font-medium text-text-on-cta">{CARD_LABEL}</span>
      </div>
      <div className="m-0.5 mt-0 flex flex-col gap-2 rounded-[10px] bg-white p-2.5">
        <span className="wrap-anywhere text-caption font-semibold text-text-primary">
          {escalation.issue}
        </span>
        {escalation.context && (
          <p className="line-clamp-4 whitespace-pre-wrap wrap-anywhere text-micro text-text-muted">
            {escalation.context}
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {escalation.options.map((option, i) => {
            const recommended = escalation.recommendation?.index === i;
            const chosen = answeredIndex === i;
            return (
              <li key={i} className="flex flex-col gap-0.5">
                {canAnswer ? (
                  <button
                    type="button"
                    disabled={busy}
                    data-option-index={i}
                    onClick={() => onAnswer?.(i)}
                    className={cn(
                      "w-full truncate rounded-[8px] px-2.5 py-1 text-left text-micro font-medium disabled:opacity-60",
                      recommended
                        ? "auth-btn-3d text-white"
                        : "auth-btn-3d-light text-text-primary"
                    )}
                  >
                    {option.label}
                  </button>
                ) : (
                  <span
                    data-option-index={i}
                    className={cn(
                      "truncate text-micro",
                      chosen ? "font-medium text-text-primary" : "text-text-muted"
                    )}
                  >
                    {chosen && (
                      <Check
                        size={11}
                        aria-hidden
                        className="mr-1 inline-block align-[-1px]"
                      />
                    )}
                    {option.label}
                  </span>
                )}
                <span className="wrap-anywhere pl-0.5 text-micro text-text-muted">
                  {option.consequence}
                </span>
              </li>
            );
          })}
        </ul>
        {escalation.recommendation && (
          <p className="wrap-anywhere text-micro text-text-muted">
            {escalation.recommendation.why}
          </p>
        )}
      </div>
    </div>
  );
}
