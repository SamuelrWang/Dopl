"use client";

/**
 * Channels — THE DECISION CARD: an agent's structured question to a human, with
 * the options as buttons (Samuel, 2026-08-31; restyled 2026-09-20).
 *
 * ⚠ ITS OWN FILE FROM THE START (§1). `transcript.tsx` crossed the 500-line cap
 * once already and shed two row shapes doing it; a third card added inline would
 * have put it straight back.
 *
 * 🔒 **THE BAR IS THE POSTING AGENT'S COLOUR AND IT SAYS "Needs Your Decision"**
 * (Samuel, 2026-09-20). The card used to be black chrome on every post — one
 * ink, whoever asked. Three things changed and they are one ruling: the bar
 * carries the agent's own `agent-01…16` paint (black when that agent has ENDED
 * or was never coloured), the bar's type is the ATTRIBUTION PILL'S name type so
 * the two readings of "which agent" match, and the BODY is plain black prose at
 * message size — the question, a line per option, and the recommendation LAST.
 *
 * ⚠ **THE OPTION LABEL MOVED INTO THE PROSE AND THE BUTTONS SAY "Option A"**
 * (`escalation-card-face.ts › decisionOptionName`). A button wide enough to hold
 * "Wait for the migration review" is a button that wraps at two options; the
 * line above it is where that sentence belongs, and it reads better as a
 * sentence than as a control.
 *
 * ⚠ **AFTER A PRESS THE CHOSEN BUTTON STAYS BLACK AND THE REST GO GREY**, in the
 * switcher's own `--seg-fill`. That state is not local: the answer is a MESSAGE
 * (`view-model-escalation.ts › answersByEscalation`), so it survives a reload
 * because it was never in this component to begin with.
 *
 * ⚠ IT IS `thread-card-row.tsx › ThreadCardMessage`'S SHELL, DELIBERATELY. Both
 * are "a body the message POINTS AT rather than says", so both render inside
 * `authored-row.tsx › AuthoredRow` — which is what makes the side, the
 * attribution pill, the agent-name resolution and the Tags-inbox flash tint come
 * for free and stay impossible to fork.
 */

import { cn } from "@/shared/lib/utils";
import { agentBoxOf } from "./agent-box-rule";
import { AuthoredRow } from "./authored-row";
import {
  DECISION_BTN_BASE,
  DECISION_BTN_BLACK,
  DECISION_BTN_GREY,
  DECISION_CARD_LABEL,
  decisionCardPaint,
  decisionOptionName,
} from "./escalation-card-face";
import type { AuthorIndex } from "./view-model";
import type { EscalationRow } from "./view-model-escalation";

/**
 * **THE BAR'S TYPE IS THE PILL'S NAME TYPE, TO THE CLASS** (Samuel: *"make the
 * font styling of that header to be the same as that of the bolded text that's
 * in the badge for the name of the agent in the channel. And same size."*).
 *
 * ⚠ It is spelled out rather than imported because `attribution-pill.tsx` wears
 * it inline on a `<span>` with no constant to take; the pairing is asserted in
 * `escalation-card.test.tsx` so the two cannot drift silently.
 */
const BAR_TYPE = "text-body font-semibold leading-tight text-text-on-cta";

/** The card's one body face — black ink at MESSAGE size, for every line
 *  (Samuel: *"black text, in the same fontsize as the normal text"*). */
const BODY_TYPE = "wrap-anywhere text-body text-text-primary";

/** The button box. ⚠ `text-caption` and not `text-body`: the buttons are the
 *  control strip under the prose, and "Option A" at body size reads as another
 *  sentence in the paragraph it is meant to answer. */
const BTN_BOX = "h-[27px] px-3 text-caption";

/**
 * What an ANSWERED card says under its buttons.
 *
 * ⚠ IT NAMES THE PERSON, and that is the whole reason it survived the restyle:
 * the grey buttons say WHICH option won, and in a room where several people
 * could have pressed, only this line says WHO. `byLabel` is the transcript's own
 * `labelFor` — "You" for the viewer, the roster name otherwise.
 */
function answeredLine(byLabel: string): string {
  return byLabel === "You" ? "You chose" : `${byLabel} chose`;
}

export function EscalationCardMessage({
  row,
  index,
  flash,
  busy,
  onAnswer,
}: {
  row: EscalationRow;
  /** ⚠ FOR THE COLOUR AND NOTHING ELSE — `agent-box-rule.ts › agentBoxOf` reads
   *  the LIVE projection, because a key goes back to the channel's bank when its
   *  session ends and a colour stamped on the row would keep painting a hue
   *  another agent now owns. */
  index: AuthorIndex;
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
  // ⚠ THE SAME PREDICATE EVERY OTHER ROW'S ACCENT USES, so one agent cannot be
  // one colour in its bar and another in its pill. `null` — a person's post, a
  // channel-less MCP post, an ENDED session — resolves to black in
  // `decisionCardPaint`, which is Samuel's ended rule and also the pre-restyle
  // face, so nothing regresses when a colour is unavailable.
  const paint = decisionCardPaint(agentBoxOf(row, index)?.color);
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
      {/* The shell is `thread-card-row.tsx`'s geometry with the ink swapped for
          the agent's paint: the white panel is inset by `m-0.5 mt-0`, so the
          sliver around it IS the border line and the bar and the border are one
          colour by construction. ⚠ THE `var()` GOES THROUGH `style` because the
          palette member is chosen by DATA — `bg-[var(--agent-color-${key})]` is
          a class the JIT never sees (`agent-box-rule.ts`'s argument, in full). */}
      <div
        data-escalation-id={row.id}
        data-decision-paint={row.agentId ?? undefined}
        className="mt-1 w-full max-w-[460px] overflow-hidden rounded-[14px] text-left"
        style={{ backgroundColor: paint }}
      >
        <div className="flex items-center px-3 py-2">
          <span className={BAR_TYPE}>{DECISION_CARD_LABEL}</span>
        </div>
        <div className="m-0.5 mt-0 flex flex-col gap-2 rounded-[12px] bg-white p-3">
          {/* ⚠ PLAIN LINES, IN READING ORDER: what is being decided, any
              context, then one line per option saying what it does. Nothing is
              behind a disclosure — a question you have to expand to answer is
              the prose wall this card replaced. */}
          <p className={BODY_TYPE}>{escalation.issue}</p>
          {escalation.context && (
            <p className={cn(BODY_TYPE, "whitespace-pre-wrap")}>
              {escalation.context}
            </p>
          )}

          <ul className="flex flex-col gap-1">
            {escalation.options.map((option, i) => (
              <li key={i} className={BODY_TYPE}>
                {/* ⚠ THE LABEL AND THE CONSEQUENCE ARE THEIR OWN ELEMENTS, not
                    one interpolated string: the same words are the BUTTON's
                    accessible name, and a test (or a reader) must be able to
                    find either one on its own. */}
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

          {/* ⚠ **LAST LINE, ALWAYS** (Samuel: *"The last line of the paragraph
              the agent should say its recommendation"*) — so it sits below the
              options and above the controls, never beside the option it names. */}
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
              const chosen = answer?.optionIndex === i;
              const face = cn(
                DECISION_BTN_BASE,
                BTN_BOX,
                // ⚠ BEFORE A PRESS EVERY OPTION IS BLACK — they are equals, and
                // greying one early would read as an answer nobody gave. AFTER a
                // press exactly the chosen one stays.
                answer ? (chosen ? DECISION_BTN_BLACK : DECISION_BTN_GREY) : DECISION_BTN_BLACK
              );
              if (!canAnswer) {
                // ⚠ READ-ONLY IS A SPAN, NOT A DEAD BUTTON — a peer reading
                // somebody else's question, and every answered card, land here.
                // The FACE is identical, so the strip does not change shape when
                // it stops being pressable; only its element does.
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
                  /* ⚠ THE LETTER IS ON THE FACE, THE MEANING IS IN THE NAME. A
                     screen reader hearing "Option A" alone would have to go back
                     up the prose to find out what it does. */
                  aria-label={`${decisionOptionName(i)}: ${option.label}`}
                  onClick={() => onAnswer?.(i)}
                  className={cn(face, "disabled:opacity-60")}
                >
                  {decisionOptionName(i)}
                </button>
              );
            })}
          </div>

          {answer && (
            <p className="flex flex-wrap items-center gap-1 text-caption text-text-muted">
              {answeredLine(answer.byLabel)}{" "}
              <span className="min-w-0 truncate font-medium text-text-primary">
                {escalation.options[answer.optionIndex]?.label ?? "an option"}
              </span>
            </p>
          )}
        </div>
      </div>
    </AuthoredRow>
  );
}
