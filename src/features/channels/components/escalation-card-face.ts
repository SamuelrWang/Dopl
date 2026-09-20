/**
 * **THE DECISION CARD'S FACE — ONE SPELLING FOR BOTH RENDERERS** (Samuel,
 * 2026-09-20).
 *
 * ⚠ **THERE ARE TWO CARDS AND THEY ARE NOT ONE COMPONENT.**
 * `escalation-card-row.tsx` draws the transcript's card inside
 * `authored-row.tsx › AuthoredRow`; `agent-stream-escalation.tsx` draws the same
 * question inside the agent stream, which has no sides, no pills and its own row
 * union. They cannot share a component without one of them growing a chrome prop
 * for the other's shell — so they share the FACE instead: the bar's words, the
 * option names, the paint rule and the three button skins live here, and the two
 * files differ only in size steps.
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
 * buttons stay short enough to sit in one row at any option count. The schema
 * caps options at SIX (`escalation.ts › ChannelEscalationSchema`), so six letters
 * is the whole domain and a seventh index can only come from a payload the parser
 * already refused.
 * ⚠ **IT NEVER FALLS BACK TO A NUMBER.** An out-of-range index would be a parser
 * bug wearing a rendered label; `A` + the index is arithmetic that cannot fail, and
 * the cap is asserted by the schema rather than restated here.
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
