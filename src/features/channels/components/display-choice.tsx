"use client";

/**
 * **THE CHOICE BLOCK — a display's one answerable block** (docs/specs/unified-display.md §7.3).
 * Each option is one pressable row carrying its own consequence; the recommendation and its why
 * ride on the option they recommend.
 *
 * ⚠ **THE ANSWER IS A STATE OF THE ROWS, AND IT IS NOT LOCAL.** The chosen row goes ink and the
 * rest go quiet off the message's stamp or the page's answer message (`view-model-display.ts ›
 * answersByEscalation`), so it survives a reload. The one local fact is `pendingIndex`, the press
 * in flight, shown chosen until the re-read lands.
 *
 * ⚠ **ABSENT, NEVER DISABLED.** No `onChoose` (the viewer is not an answerer, the host carries no
 * write, or it is answered) renders the same rows as plain blocks.
 */

import { useId } from "react";
import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { StatusPill } from "@/shared/ui/status-pill";
import type { ChoiceBlock, ChoiceOption, DisplayAnswerStamp } from "@/features/display/core/types";
import type { AgentCardFace } from "./escalation-card-face";

function OptionRow({
  option,
  index,
  chosen,
  quiet,
  face,
  onChoose,
}: {
  option: ChoiceOption;
  index: number;
  chosen: boolean;
  quiet: boolean;
  face: AgentCardFace;
  onChoose?: () => void;
}) {
  const noteId = useId();
  const note = chosen ? "text-text-on-cta/70" : "text-text-tertiary";
  const body = (
    <>
      <span className="flex items-center gap-1.75">
        <span
          className={cn(
            "min-w-0 flex-1 font-medium",
            face.optionLabel,
            chosen ? "text-text-on-cta" : "text-text-primary"
          )}
        >
          {option.label}
        </span>
        {option.recommended && (
          <StatusPill className={cn(chosen && "bg-text-on-cta/15 text-text-on-cta")}>
            Recommended
          </StatusPill>
        )}
        {chosen && <Check size={13} strokeWidth={2.4} aria-hidden className="flex-none text-text-on-cta" />}
      </span>
      {option.description && (
        <span id={noteId} className={cn(face.optionNote, note)}>
          {option.description}
        </span>
      )}
      {option.recommended && option.why && (
        <span
          className={cn(
            "mt-0.5 border-l-2 pl-2",
            face.optionNote,
            chosen ? "border-text-on-cta/20 text-text-on-cta/70" : "border-border-default text-text-muted"
          )}
        >
          {option.why}
        </span>
      )}
    </>
  );
  const skin = cn(
    "white-card flex w-full flex-col text-left",
    face.option,
    option.recommended && "border-border-strong",
    chosen && "border-surface-cta bg-surface-cta",
    quiet && "border-border-subtle bg-bg-inset opacity-70 shadow-none"
  );
  const attrs = {
    "data-option-index": index,
    "data-chosen": chosen || undefined,
    "data-quiet": quiet || undefined,
    "data-recommended": option.recommended || undefined,
  };
  if (!onChoose) {
    return (
      <div {...attrs} className={skin}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      {...attrs}
      aria-label={option.label}
      aria-describedby={option.description ? noteId : undefined}
      onClick={onChoose}
      className={cn(skin, "raise hover:border-border-strong")}
    >
      {body}
    </button>
  );
}

export function DisplayChoice({
  choice,
  answer,
  answeredBy,
  pendingIndex,
  face,
  onChoose,
}: {
  choice: ChoiceBlock;
  /** The stored stamp, else the page's answer message (`view-model-display.ts › displayViewFrom`). */
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
  return (
    <>
      <div role="group" aria-label="Options" className={face.options}>
        {choice.options.map((option, i) => (
          <OptionRow
            key={i}
            option={option}
            index={i}
            chosen={chosenIndex === i}
            quiet={settled && chosenIndex !== i}
            face={face}
            onChoose={onChoose && !settled ? () => onChoose(i) : undefined}
          />
        ))}
      </div>
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
