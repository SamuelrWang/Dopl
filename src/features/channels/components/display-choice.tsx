"use client";

/**
 * **THE CHOICE BLOCK — a display's one answerable block, and the decision card's face** (Samuel,
 * 2026-08-31 / 2026-09-20; unified 2026-09-28, docs/specs/unified-display.md §7.3).
 *
 * Two faces of one block:
 * - **decision face** — exactly the escalation card as it was: per option an `AgentPill`
 *   `Option A` badge over `label: description` (no dash), `Recommended: [Option X]` + why LAST,
 *   then the `Option A…` button strip (the meaning is in the accessible name), then who chose.
 *   Drawn when any option carries a description / recommendation / why, and for every legacy
 *   decision (the adapter's `from: "escalation"`), so old cards look as they did.
 * - **inline face** — a bare choice: the buttons carry the labels themselves.
 *
 * ⚠ **AFTER A PRESS THE CHOSEN BUTTON STAYS BLACK AND THE REST GO GREY** (`--seg-fill`), and that
 * state is not local: the answer is the message's stamp or the page's answer message
 * (`view-model-escalation.ts › answersByEscalation`), so it survives a reload. The one local fact is
 * `pendingIndex` — the press in flight, shown chosen until the re-read lands.
 *
 * ⚠ **ABSENT, NEVER DISABLED.** No `onChoose` (the viewer is not an answerer, the host carries no
 * write, or it is answered) renders read-only spans with the same face, so the strip does not change
 * shape when it stops being pressable.
 */

import { cn } from "@/shared/lib/utils";
import type { ChoiceBlock, DisplayAnswerStamp } from "@/features/display/core/types";
import { AgentPill } from "./agent-bits";
import {
  DECISION_BTN_BASE,
  DECISION_BTN_BLACK,
  DECISION_BTN_GREY,
  decisionOptionName,
  type AgentCardFace,
} from "./escalation-card-face";

/** The decision face is the one to draw — any option explains itself, or it is a legacy decision. */
export const isDecisionFace = (choice: ChoiceBlock, legacy: boolean): boolean =>
  legacy || choice.options.some((o) => o.description || o.recommended || o.why);

export function DisplayChoice({
  choice,
  decisionFace,
  answer,
  answeredBy,
  pendingIndex,
  face,
  onChoose,
}: {
  choice: ChoiceBlock;
  decisionFace: boolean;
  /** The stored stamp, else the page's answer message (`displayOf`'s `pageAnswer`). */
  answer: DisplayAnswerStamp | null;
  /** "You" / the answering member's name, when it can be said. */
  answeredBy: string | null;
  /** A press in flight on this card. */
  pendingIndex: number | null;
  face: AgentCardFace;
  onChoose?: (index: number) => void;
}) {
  const chosenIndex = answer?.index ?? pendingIndex;
  const settled = chosenIndex !== null;
  const recommended = choice.options.findIndex((o) => o.recommended);
  const rec = recommended >= 0 ? choice.options[recommended] : null;
  const strip = choice.options.map((option, i) => {
    const chosen = chosenIndex === i;
    const skin = cn(
      DECISION_BTN_BASE,
      face.btnBox,
      !decisionFace && "max-w-full",
      // Before a press every option is black — equals; after, exactly the chosen one stays.
      settled && !chosen ? DECISION_BTN_GREY : DECISION_BTN_BLACK
    );
    const text = decisionFace ? (
      decisionOptionName(i)
    ) : (
      <span className="truncate">{option.label}</span>
    );
    if (!onChoose || settled) {
      return (
        <span key={i} data-option-index={i} data-chosen={chosen || undefined} className={skin}>
          {text}
        </span>
      );
    }
    return (
      <button
        key={i}
        type="button"
        data-option-index={i}
        aria-label={decisionFace ? `${decisionOptionName(i)}: ${option.label}` : undefined}
        onClick={() => onChoose(i)}
        className={skin}
      >
        {text}
      </button>
    );
  });

  if (!decisionFace) {
    return <div className="flex flex-wrap items-center gap-1.5">{strip}</div>;
  }
  return (
    <>
      <ul className={face.options}>
        {choice.options.map((option, i) => (
          <li key={i} className="flex flex-col items-start gap-0.5">
            <AgentPill>{decisionOptionName(i)}</AgentPill>
            {/* Label and description are their own elements: the label is also the button's name. */}
            <p className={face.body}>
              <span>{option.label}</span>
              {option.description && (
                <>
                  {": "}
                  <span>{option.description}</span>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      {rec && (
        <div className="flex flex-col items-start gap-0.5">
          <p className={cn(face.body, "flex items-center gap-1.5")}>
            Recommended:
            <AgentPill>{decisionOptionName(recommended)}</AgentPill>
          </p>
          {rec.why && <p className={face.body}>{rec.why}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{strip}</div>
      {answer && answeredBy && (
        <p className="flex flex-wrap items-center gap-1 text-caption text-text-muted">
          {answeredBy === "You" ? "You chose" : `${answeredBy} chose`}{" "}
          <span className="min-w-0 truncate font-medium text-text-primary">
            {choice.options[answer.index]?.label ?? answer.choice}
          </span>
        </p>
      )}
    </>
  );
}
