"use client";

/**
 * **THE "NEEDS YOUR DECISION" BOX, RESTRUCTURED** (Samuel, 2026-10-22, ask 6b: *"right now
 * it looks really messy and it needs to be a lot better formatted, have better UI"*).
 *
 * ⚠ **THE PRODUCT CARD IS UNTOUCHED.** `channels/components/display-card.tsx` +
 * `display-choice.tsx` are shared with the real web app and the desktop. The scene still
 * renders them; {@link StagingDecisionCards} hides each one and portals this face in after
 * it (`demo-swap.ts`), the same way the thread card is staged.
 *
 * ── WHAT CHANGED, ELEMENT BY ELEMENT ──
 * The old card laid four same-weight things on top of each other and split the one that
 * matters in half: the prose listed `[Option A] label: description` for every option, a
 * `Recommended: [Option B]` paragraph followed, and THEN a strip of buttons reading
 * "Option A", "Option B". The letters existed only to keep that strip short, so reading the
 * card meant holding a letter→meaning table in your head and pressing a button that said
 * nothing. That is the mess.
 *
 * 1. **The question is the card.** One line, the largest type in the box, at the top. It is
 *    the only thing a reader must take in before they can act.
 * 2. **The context is secondary, and looks it.** Muted, directly under the question, no
 *    heading over it. It answers "why are you asking me", which is a supporting fact.
 * 3. **An option is ONE pressable row carrying its own consequence.** Label in ink,
 *    consequence under it, the whole row is the button. No letters, no second strip: you
 *    press the thing you just read.
 * 4. **The recommendation rides on the option it recommends** — a marker in that row and
 *    the reason inside it, instead of a paragraph pointing at a letter.
 * 5. **The answer is a state of the rows**, not a sentence appended to the card: the chosen
 *    row stays ink, the rest go quiet, and one muted line says who chose.
 *
 * ⚠ STAGING: the press is LOCAL STATE. The real card writes through `use-display-writes`;
 * staging never touches the network.
 * ⚠ Blocks other than `heading` / `text` / `choice` are not drawn by this face. The staged
 * fixture (`../data/decision-fixture.ts`) carries only those three; a display with a table
 * or a meter still renders through the product card on the real surfaces.
 */

import { useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import type { ChannelMessage } from "@/features/channels/types";
import type { AuthorIndex } from "@/features/channels/components/view-model";
import { displayViewOf, answersByEscalation } from "@/features/channels/components/view-model-display";
import { decisionCardPaint } from "@/features/channels/components/escalation-card-face";
import { choiceOf, type ChoiceOption } from "@/features/display/core/types";
import type { DisplayView } from "@/features/channels/components/display-card";
import { useDemoSwap } from "@/features/marketing/components/banner-demo/demo-swap";

/** The product card this face replaces (`display-card.tsx`'s root). */
const PRODUCT_CARD = "[data-display-id]";

const BAR_LABEL = "Needs your decision";

function textOf(view: DisplayView, type: "heading" | "text"): string[] {
  return view.display.blocks.flatMap((b) =>
    b.type === type
      ? [b.type === "heading" ? b.text : (b as { content: string }).content]
      : []
  );
}

export function StagingDecisionCard({
  view,
  paint,
}: {
  view: DisplayView;
  /** The posting agent's colour (`escalation-card-face.ts › decisionCardPaint`). */
  paint: string;
}) {
  const choice = choiceOf(view.display.blocks);
  const stored = view.display.answer?.index ?? null;
  const [local, setLocal] = useState<number | null>(null);
  const chosen = stored ?? local;
  const settled = chosen !== null;
  const question = textOf(view, "heading")[0];
  const context = textOf(view, "text");
  const answerable = view.answerable && !view.display.superseded_by;

  return (
    <div className="uis-dc">
      <div className="uis-dc-panel">
        {/* ⚠ A TAG, NOT A BAND (the Blank Space Rule, 2026-10-22). It was a full-bleed
            bar in the agent's paint carrying three words at its left edge, which is the
            "overly long bar ... ton of empty space" the rule names. Sized to its content it
            still carries the agent's colour and still says the reader's job. */}
        <span className="uis-dc-tag" style={{ backgroundColor: paint }}>
          {BAR_LABEL}
        </span>
        {question && <p className="uis-dc-q">{question}</p>}
        {context.map((line, i) => (
          <p key={i} className="uis-dc-ctx">
            {line}
          </p>
        ))}

        {choice && (
          <div className="uis-dc-options" role="group" aria-label="Options">
            {choice.options.map((option, i) => (
              <Option
                key={i}
                option={option}
                index={i}
                chosen={chosen === i}
                settled={settled}
                onChoose={answerable && !settled ? () => setLocal(i) : undefined}
              />
            ))}
          </div>
        )}

        {settled && choice && (
          <p className="uis-dc-answered">
            {(view.answeredBy ?? "You") === "You" ? "You chose" : `${view.answeredBy} chose`}{" "}
            <b>{choice.options[chosen]?.label}</b>
          </p>
        )}
      </div>
    </div>
  );
}

function Option({
  option,
  index,
  chosen,
  settled,
  onChoose,
}: {
  option: ChoiceOption;
  index: number;
  chosen: boolean;
  settled: boolean;
  onChoose?: () => void;
}) {
  const body = (
    <>
      <span className="uis-dc-opt-top">
        <span className="uis-dc-opt-label">{option.label}</span>
        {option.recommended && <span className="uis-dc-opt-rec">Recommended</span>}
        {chosen && <Check size={13} strokeWidth={2.4} aria-hidden className="uis-dc-opt-tick" />}
      </span>
      {option.description && <span className="uis-dc-opt-what">{option.description}</span>}
      {option.recommended && option.why && (
        <span className="uis-dc-opt-why">{option.why}</span>
      )}
    </>
  );
  const attrs = {
    className: "uis-dc-opt",
    "data-option-index": index,
    "data-chosen": chosen || undefined,
    "data-quiet": (settled && !chosen) || undefined,
    "data-recommended": option.recommended || undefined,
  };
  // Absent, not disabled — the family's rule: a card nobody here may answer keeps its shape.
  if (!onChoose) return <div {...attrs}>{body}</div>;
  return (
    <button type="button" onClick={onChoose} {...attrs}>
      {body}
    </button>
  );
}

/** Finds every display card in the pane and portals the staged face after it. */
export function StagingDecisionCards({
  paneRef,
  messages,
  index,
}: {
  paneRef?: RefObject<HTMLDivElement | null>;
  messages: readonly ChannelMessage[];
  index: AuthorIndex;
}) {
  const answers = useMemo(() => answersByEscalation(messages, index), [messages, index]);
  const views = useMemo(() => {
    const out = new Map<string, { view: DisplayView; agentId: string | null }>();
    for (const m of messages) {
      const view = displayViewOf(m, index, answers);
      if (!view) continue;
      out.set(view.display.display_id, {
        view,
        agentId: m.clientMsgId?.split("-")[1] ?? null,
      });
    }
    return out;
  }, [messages, index, answers]);

  const swaps = useDemoSwap(
    paneRef,
    (pane) =>
      [...pane.querySelectorAll<HTMLElement>(PRODUCT_CARD)].flatMap((card) => {
        const key = card.getAttribute("data-display-id") ?? "";
        return views.has(key) ? [{ key, source: card }] : [];
      }),
    "uis-dc-host"
  );

  return (
    <>
      {swaps.map(({ key, host }) => {
        const hit = views.get(key);
        if (!hit) return null;
        const color = hit.agentId ? (index.agents.get(hit.agentId)?.color ?? null) : null;
        return createPortal(
          <StagingDecisionCard view={hit.view} paint={decisionCardPaint(color)} />,
          host,
          key
        );
      })}
    </>
  );
}

