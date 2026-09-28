"use client";

/**
 * **THE DISPLAY BLOCKS, IN DOPL'S OWN FACE** — the platform-neutral renderer of the glasses block
 * vocabulary (`glasses/core/screens/spec.ts`: text, list, progress, divider, spacer). The glasses
 * compile the same blocks against their HUD (`glasses/platforms/*`); this draws them in chat, on
 * every channel surface, from the one card (`display-card.tsx`).
 *
 * ⚠ **NO PIXELS FROM THE SPEC.** `absolute` layout's `x`/`y`/`w`/`h` are HUD coordinates; here they
 * only ORDER the blocks (top-to-bottom, then left-to-right), and `lines` / `brightness` map onto the
 * type scale rather than onto a box.
 */

import { cn } from "@/shared/lib/utils";
import { UsageMeter } from "@/shared/ui/usage-meter";
import type { DisplayAnswer, DisplayBlock, MessageDisplay } from "../lib/message-device";
import {
  AGENT_CARD_BODY_TYPE,
  AGENT_CARD_BTN_BOX,
  DECISION_BTN_BASE,
  DECISION_BTN_BLACK,
  DECISION_BTN_GREY,
} from "./escalation-card-face";

/** The spec's default ids (`b1`, `b2`, …), so an answer names the block the agent would. */
export const blockIdOf = (block: DisplayBlock, index: number): string =>
  typeof block.id === "string" && block.id ? block.id : `b${index + 1}`;

/** HUD brightness 0-4 onto the ink ramp; unset is full brightness. */
function inkOf(brightness: unknown): string {
  if (typeof brightness !== "number" || brightness >= 3) return "text-text-primary";
  return brightness >= 2 ? "text-text-secondary" : "text-text-muted";
}

const itemsOf = (block: DisplayBlock): string[] =>
  Array.isArray(block.items) ? block.items.filter((item) => typeof item === "string") : [];

/** Top-to-bottom, then left-to-right, for `absolute`; the agent's order for `stack`. */
function ordered(display: MessageDisplay): { block: DisplayBlock; id: string }[] {
  const rows = display.blocks.map((block, i) => ({ block, id: blockIdOf(block, i) }));
  if (display.layout !== "absolute") return rows;
  const at = (value: unknown) => (typeof value === "number" ? value : 0);
  return rows.sort((a, b) => at(a.block.y) - at(b.block.y) || at(a.block.x) - at(b.block.x));
}

export function DisplayBlocks({
  display,
  onChoose,
  pending = null,
  busy = false,
}: {
  display: MessageDisplay;
  /** Answer a selectable list. ABSENT renders read-only choices, never disabled buttons. */
  onChoose?: (answer: DisplayAnswer) => void;
  /** The choice in flight, shown chosen until the stored answer arrives. */
  pending?: DisplayAnswer | null;
  busy?: boolean;
}) {
  const answer = display.answer ?? pending;
  return (
    <>
      {ordered(display).map(({ block, id }) => {
        switch (block.type) {
          case "text":
            return (
              <p
                key={id}
                data-block={id}
                className={cn(
                  AGENT_CARD_BODY_TYPE,
                  "whitespace-pre-wrap",
                  inkOf(block.brightness),
                  block.border && "rounded-[8px] border border-border-default px-2 py-1"
                )}
              >
                {typeof block.content === "string" ? block.content : ""}
              </p>
            );
          case "progress": {
            const value = typeof block.value === "number" ? Math.min(1, Math.max(0, block.value)) : 0;
            const pct = Math.round(value * 100);
            return (
              <UsageMeter
                key={id}
                label={typeof block.label === "string" ? block.label : undefined}
                used={pct}
                limit={100}
                readout={`${pct}%`}
                className=""
              />
            );
          }
          case "divider":
            return <hr key={id} className="border-border-default" />;
          case "spacer": {
            const lines = typeof block.lines === "number" ? Math.min(4, Math.max(1, block.lines)) : 1;
            return <div key={id} aria-hidden style={{ height: `${lines * 0.75}rem` }} />;
          }
          case "list":
            return (
              <DisplayList
                key={id}
                id={id}
                items={itemsOf(block)}
                selectable={block.selectable !== false}
                answer={answer}
                busy={busy}
                onChoose={onChoose}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}

/**
 * A list. SELECTABLE, it is the decision card's button strip (`escalation-card-face.ts`): black
 * before a choice, the chosen one black and the rest grey after — the same state wherever it was
 * answered, because the answer is the message's metadata, not this component's.
 */
function DisplayList({
  id,
  items,
  selectable,
  answer,
  busy,
  onChoose,
}: {
  id: string;
  items: string[];
  selectable: boolean;
  answer: DisplayAnswer | null;
  busy: boolean;
  onChoose?: (answer: DisplayAnswer) => void;
}) {
  if (!selectable) {
    return (
      <ul data-block={id} className={cn(AGENT_CARD_BODY_TYPE, "list-disc pl-5")}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  const answered = answer !== null && (answer.blockId === null || answer.blockId === id);
  return (
    <div data-block={id} className="flex flex-wrap items-center gap-1.5">
      {items.map((item, i) => {
        const chosen = answered && answer.index === i;
        const face = cn(
          DECISION_BTN_BASE,
          AGENT_CARD_BTN_BOX,
          "max-w-full",
          answered && !chosen ? DECISION_BTN_GREY : DECISION_BTN_BLACK
        );
        if (!onChoose || answered) {
          return (
            <span key={i} data-choice-index={i} data-chosen={chosen || undefined} className={face}>
              <span className="truncate">{item}</span>
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            disabled={busy}
            data-choice-index={i}
            onClick={() => onChoose({ blockId: id, choice: item, index: i })}
            className={cn(face, "disabled:opacity-60")}
          >
            <span className="truncate">{item}</span>
          </button>
        );
      })}
    </div>
  );
}
