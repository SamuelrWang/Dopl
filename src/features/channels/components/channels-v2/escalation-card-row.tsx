"use client";

/**
 * Channels v2 — THE ESCALATION CARD: an agent's structured question to a human,
 * with the options as buttons (Samuel, 2026-08-31).
 *
 * ⚠ ITS OWN FILE FROM THE START (§1). `transcript.tsx` crossed the 500-line cap
 * once already and shed two row shapes doing it; a third card added inline would
 * have put it straight back.
 *
 * ⚠ IT IS `thread-card-row.tsx › ThreadCardMessage`'S SHAPE, DELIBERATELY, AND
 * THAT IS NOT A STYLE CHOICE. Both are "a body the message POINTS AT rather than
 * says", so both render the dark CTA shell with a white panel inset inside
 * `authored-row.tsx › AuthoredRow` — which is what makes the side, the
 * attribution pill, the agent-name resolution and the Tags-inbox flash tint come
 * for free and stay impossible to fork. The only differences are the label in
 * the bar and what the panel holds.
 *
 * ⚠ THE FOUR FIELDS ARE THE PRODUCT, so they render in the order the operator
 * reads them: the ISSUE as the title, the CONTEXT clamped beneath it, the
 * OPTIONS as rows the recommended one is marked in, and the recommendation's
 * REASON under them. Nothing is hidden behind a disclosure — a question you have
 * to expand to answer is the prose wall again.
 */

import { cn } from "@/shared/lib/utils";
import { AlertCircle, Check } from "lucide-react";
import { AuthoredRow } from "./authored-row";
import type { EscalationRow } from "./view-model-escalation";

/** Bar label. ⚠ MINIMAL COPY — a noun for what this row IS, not a sentence
 *  about what to do with it. The buttons say that by being buttons. */
const CARD_LABEL = "Needs a decision";

/**
 * What an ANSWERED card says in place of its buttons.
 *
 * ⚠ IT NAMES THE PERSON, and that is the whole reason it is not just a check
 * mark: in a room where several people could have answered, "answered" without
 * a name is a fact nobody can act on. `byLabel` is the transcript's own
 * `labelFor` — "You" for the viewer, the roster name otherwise.
 */
function answeredLine(byLabel: string): string {
  return byLabel === "You" ? "You chose" : `${byLabel} chose`;
}

export function EscalationCardMessage({
  row,
  flash,
  busy,
  onAnswer,
}: {
  row: EscalationRow;
  flash: boolean;
  /** An answer is in flight — the double-submit guard, NOT a capability. */
  busy: boolean;
  /**
   * Post this option back as the answer.
   *
   * ⚠ ABSENT RENDERS NO BUTTONS AT ALL, never disabled ones — the same
   * absent-not-disabled rule `thread-card-row.tsx`'s launch button follows, and
   * for the same reason: an inert button is indistinguishable from a broken one.
   * The pop-out thread window and the guest lane hand none.
   */
  onAnswer?: (optionIndex: number) => void;
}) {
  const { escalation, answer } = row;
  // ⚠ TWO CONJUNCTS AND THEY ARE DIFFERENT FACTS. `answerable` is the SERVER's
  // rule restated (the members this escalation tagged, else its author) and
  // decides whether this viewer may act at all; `onAnswer` is whether the HOST
  // can carry an action. A card missing either is read-only, and reads as a
  // record of the question rather than as a broken control.
  const canAnswer = row.answerable && !!onAnswer && !answer;
  return (
    <AuthoredRow
      id={row.id}
      side={row.side}
      author={row.author}
      authorLabel={row.authorLabel}
      time={row.time}
      agent={false}
      continuation={false}
      flash={flash}
    >
      {/* The dark shell is `thread-card-row.tsx`'s, verbatim: `--surface-cta` /
          `--text-on-cta`, the white panel inset by `m-0.5 mt-0` so the sliver of
          ink around it IS the border line. Never a literal hex. */}
      <div
        data-escalation-id={row.id}
        className="mt-1 w-full max-w-[460px] overflow-hidden rounded-[14px] bg-surface-cta text-left ring-1 ring-surface-cta"
      >
        <div className="flex items-center gap-1.5 px-3 py-2">
          <AlertCircle size={13} aria-hidden className="shrink-0 text-text-on-cta" />
          <span className="text-small font-medium text-text-on-cta">
            {CARD_LABEL}
          </span>
          <span className="flex-1" />
        </div>
        <div className="m-0.5 mt-0 flex flex-col gap-2 rounded-[12px] bg-white p-3">
          {/* ⚠ `wrap-anywhere` for the thread card's reason: an issue with no
              spaces in it would size this column off its min-content width and
              run past the card edge. */}
          <span className="wrap-anywhere text-body font-semibold text-text-primary">
            {escalation.issue}
          </span>
          {escalation.context && (
            <p className="line-clamp-6 whitespace-pre-wrap wrap-anywhere text-caption text-text-muted">
              {escalation.context}
            </p>
          )}

          <ul className="flex flex-col gap-1.5">
            {escalation.options.map((option, i) => {
              const recommended = escalation.recommendation?.index === i;
              const chosen = answer?.optionIndex === i;
              return (
                <li key={i} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    {canAnswer ? (
                      <button
                        type="button"
                        disabled={busy}
                        data-option-index={i}
                        onClick={() => onAnswer?.(i)}
                        className={cn(
                          "min-w-0 flex-1 truncate rounded-[8px] px-3 py-1.5 text-left text-caption font-medium disabled:opacity-60",
                          recommended
                            ? "auth-btn-3d text-white"
                            : "auth-btn-3d-light text-text-primary"
                        )}
                      >
                        {option.label}
                      </button>
                    ) : (
                      // ⚠ READ-ONLY IS A ROW, NOT A DEAD BUTTON. A peer reading
                      // somebody else's escalation, and the same card after it
                      // has been answered, both land here.
                      <span
                        data-option-index={i}
                        className={cn(
                          "min-w-0 flex-1 truncate text-caption",
                          chosen
                            ? "font-medium text-text-primary"
                            : "text-text-muted"
                        )}
                      >
                        {chosen && (
                          <Check
                            size={12}
                            aria-hidden
                            className="mr-1 inline-block align-[-1px]"
                          />
                        )}
                        {option.label}
                      </span>
                    )}
                    {recommended && (
                      <span className="shrink-0 text-micro font-medium text-link">
                        Recommended
                      </span>
                    )}
                  </div>
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

          {answer && (
            <p className="flex items-center gap-1.5 text-caption text-text-primary">
              <Check size={12} aria-hidden className="shrink-0" />
              {answeredLine(answer.byLabel)}{" "}
              <span className="min-w-0 truncate font-medium">
                {escalation.options[answer.optionIndex]?.label ?? "an option"}
              </span>
            </p>
          )}
        </div>
      </div>
    </AuthoredRow>
  );
}
