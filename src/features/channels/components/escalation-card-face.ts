/**
 * **THE AGENT CARD'S FACE — the decision card's spelling, now every display's** (Samuel,
 * 2026-09-20; unified 2026-09-28, docs/specs/unified-display.md §7.3).
 *
 * ⚠ **ONE CARD, TWO HOSTS.** `display-card.tsx` draws every display (a decision is a display with a
 * `choice` block) in the transcript, inside `authored-row.tsx › AuthoredRow`, and in the agent
 * stream, which has no sides and no pills. The hosts differ only in {@link AGENT_CARD_FACE}'s size
 * step; the bar's words, the option names, the paint rule and the three button skins live here.
 *
 * ⚠ **IT IS A `.ts`**, no JSX and no React import, for `agent-box-rule.ts`'s own
 * reason: a component cannot accidentally hang state off a constant table.
 */

import { agentColorVar } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";

/**
 * **THE BAR'S WORDS** (Samuel, 2026-09-20: *"I want the top bar, to instead say,
 * Needs Your Decision"*).
 *
 * ⚠ It replaces the noun "Needs a decision", which named the ROW; this names the
 * READER's job, which is what a bar over two buttons is for. One constant, both
 * renderers — two spellings is how one question came to look like two things.
 */
export const DECISION_CARD_LABEL = "Needs Your Decision";

/**
 * **THE BAR'S COLOUR: THE POSTING AGENT'S, ELSE BLACK** (Samuel: *"whatever
 * agent posted/created it, that should be the color. If the agent ends or gets
 * deleted, then it should just turn black."*).
 *
 * ⚠ **BLACK HERE IS NOT `agent-box-rule.ts › AGENT_ACCENT_NEUTRAL`, AND THE
 * DIFFERENCE IS A RULING RATHER THAN AN OVERSIGHT.** An ended agent's ROW wears
 * `--border-strong` (12% black) because a hairline ring at full ink would shout
 * over the transcript; this is a filled BAR carrying white type, and Samuel
 * named its ended face literally — black, which is `--surface-cta`, the same ink
 * the card wore on every post before this wave. So an ended agent's card is
 * exactly today's card, and a live agent's card is today's card in its colour.
 *
 * ⚠ **A `var()` REFERENCE, NEVER A LITERAL** — docs/DESIGN-SYSTEM.md's rule, and
 * `lib/agent-colors.ts › agentColorVar` stays the only place the palette token
 * name is spelled.
 */
export const DECISION_CARD_INK = "var(--surface-cta)";

export function decisionCardPaint(color: AgentColorKey | null | undefined): string {
  return color ? agentColorVar(color) : DECISION_CARD_INK;
}

/**
 * **WHAT A BUTTON SAYS: "Option A", "Option B", …** (Samuel: *"black buttons,
 * each filled with like the option, but in a concise format, like Option A,
 * Option B"*).
 *
 * ⚠ **THE LETTER IS THE BUTTON AND THE LABEL IS A LINE OF THE BODY**, which is
 * the whole shape of the restyle: the prose says what each option does, the
 * buttons stay short enough to sit in one row at any option count. A `choice`
 * caps options at TWELVE (docs/specs/unified-display.md §2.2), so `A`…`L` is the
 * whole domain; the cap is asserted by the normalizer rather than restated here.
 */
export function decisionOptionName(index: number): string {
  return `Option ${String.fromCharCode(65 + index)}`;
}

/**
 * **THE THREE BUTTON SKINS.**
 *
 * - {@link DECISION_BTN_BLACK} — pressable, and the CHOSEN one after a press
 *   (Samuel: *"that option to remain the black button"*). `.auth-btn-3d` is the
 *   app's own black face; no new fill is minted here.
 * - {@link DECISION_BTN_GREY} — every option that was NOT chosen (Samuel: *"the
 *   other options, should just get grayed out, so that it looks like the gray
 *   switchers at the top"*). `--seg-fill` IS that switcher's gray, read through
 *   the same variable `shared/ui/segmented-control.tsx` reads, so the two cannot
 *   drift to two greys.
 *
 * ⚠ **A GREY OPTION IS ALSO WHAT AN UNANSWERABLE CARD WEARS** — a peer reading
 * somebody else's question. That surface renders SPANS rather than disabled
 * buttons (the family's absent-not-disabled rule, pinned in
 * `escalation-card.test.tsx`), so the skin has to look right on a non-button too,
 * which is why these are fills and not `<button>` states.
 */
export const DECISION_BTN_BASE =
  "inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-colors";
export const DECISION_BTN_BLACK = "auth-btn-3d text-white";
export const DECISION_BTN_GREY = "bg-[var(--seg-fill)] text-text-secondary";

/**
 * **THE AGENT CARD'S SHELL, IN TWO SIZE STEPS** — a painted bar over a white panel inset by
 * `m-0.5 mt-0`, so the sliver around the panel IS the border and bar and border are one colour by
 * construction. ONE card wears it (`display-card.tsx`, every display and every decision); `row` is
 * the transcript's step, `stream` the agent stream's one notch under it (the only licensed
 * difference between the two). The paint goes through `style` (`decisionCardPaint`), never a class
 * the JIT cannot see. The bar's `row` type is the attribution pill's name type, to the class
 * (pinned in `escalation-card-face.test.tsx`).
 */
export type AgentCardSize = "row" | "stream";

export interface AgentCardFace {
  shell: string;
  bar: string;
  barType: string;
  panel: string;
  /** Black ink at the step's message size, for every body line. */
  body: string;
  /** The button box of the control strip under the prose. */
  btnBox: string;
  /** The decision face's option list. */
  options: string;
}

export const AGENT_CARD_FACE: Record<AgentCardSize, AgentCardFace> = {
  row: {
    shell: "mt-1 w-full max-w-[460px] overflow-hidden rounded-[14px] text-left",
    bar: "flex items-center gap-2 px-3 py-2",
    barType: "text-body font-semibold leading-tight text-text-on-cta",
    panel: "m-0.5 mt-0 flex flex-col gap-2 rounded-[12px] bg-white p-3",
    body: "wrap-anywhere text-body text-text-primary",
    btnBox: "h-[27px] px-3 text-caption",
    options: "flex flex-col gap-1",
  },
  stream: {
    shell: "overflow-hidden rounded-[12px] text-left",
    bar: "flex items-center gap-2 px-2.5 py-1.5",
    barType: "text-caption font-semibold leading-tight text-text-on-cta",
    panel: "m-0.5 mt-0 flex flex-col gap-1.5 rounded-[10px] bg-white p-2.5",
    body: "wrap-anywhere text-caption text-text-primary",
    btnBox: "h-[24px] px-2.5 text-micro",
    options: "flex flex-col gap-0.5",
  },
};
