/**
 * Channels — **HOW AN EXCHANGE ENDED**: the lifecycle kinds, and the RECEIPT row a
 * terminal one becomes.
 *
 * ⚠ **A §1 SPLIT OUT OF `view-model-rows.ts` ON 2026-09-22, AND THE SEAM IS THE REASON TO
 * CHANGE RATHER THAN THE LINE COUNT** — the same split, on the same argument, as
 * `view-model-escalation.ts`: that file owns the ESCALATION product, this one owns the
 * LIFECYCLE vocabulary (`lib/message-receipt.ts`, `main/trigger-outcomes.js`, the calm
 * flag), and the container owns what a MESSAGE row looks like. A receipt is not somebody's
 * words: it is the transcript narrating itself, and it moves when the desktop's endings
 * move. The container file was 4 lines under the 500-line cap when the recipient tag landed
 * on it, which is the cap doing its job — it named a seam that was already here.
 *
 * ⚠ **IT MOVED VERBATIM.** Nothing about a receipt's shape, its label or its `calm`
 * reading changed in the move, and {@link ReceiptRow} is RE-EXPORTED from
 * `view-model-rows.ts` so no importer had to move either.
 */

import {
  RECEIPT_LABEL,
  lifecycleReceiptStatus,
  type ReceiptStatus,
} from "../lib/message-receipt";
import type { ChannelMessage } from "../types";

/**
 * A RECEIPT: how one exchange ENDED, on a slim muted line of its own. No side,
 * no avatar, no author, because it is not somebody's words — the same shape as
 * `view-model-rows.ts › SystemRow` on purpose: both are the transcript narrating itself.
 *
 * ⚠ The desktop's own body copy is NOT carried here. `label` comes from the
 * FLAG via `lib/message-receipt.ts › RECEIPT_LABEL`, so a caller-influenceable
 * sentence can never state the outcome (INVARIANTS §5).
 */
export interface ReceiptRow {
  kind: "receipt";
  id: string;
  seq: number;
  status: ReceiptStatus;
  /** Flag-derived label — never the row's own body. */
  label: string;
  /** An operator-chosen ending; only a REAL `failed` is false. */
  calm: boolean;
  time: string;
}


/**
 * The three RUNTIME-STATE kinds. Never a message bubble on any surface — the
 * most a lifecycle row can be is a receipt, and `task_started` cannot even be
 * that. ⚠ `task_progress` is deliberately absent: the calm `session_ended` note
 * is the milestone lane and its BODY is real prose a peer needs (INVARIANTS §5).
 */
export function isLifecycleKind(message: ChannelMessage): boolean {
  return (
    message.kind === "task_started" ||
    message.kind === "task_finished" ||
    message.kind === "task_failed"
  );
}

/**
 * A terminal lifecycle row's RECEIPT ROW, or null when it renders as nothing.
 *
 * ⚠ **THIS USED TO DROP ALL THREE KINDS, AND THAT SILENCED THIS BUILD'S OWN
 * CONSENT OUTCOMES.** `main/trigger-outcomes.js` posts `task_failed` +
 * `{declined:true}` / `{dropped:true}` / `{interrupted:true}` on the SHIPPING
 * desktop and the headless lane posts the full set, so a peer who DECLINED left
 * the requester looking at an unanswered ask. A calm ending changes how the peer
 * reads the exchange — INVARIANTS §5's calm-flag rationale is the whole argument
 * for storing the flag — so it renders.
 *
 * Still nothing, and the line is drawn at the KIND: **`task_started` always**
 * (run state lives in the Agents tab — INVARIANTS §5; the ruling arrived in the
 * port's intent doc, deleted at the Phase 12 cutover), and a terminal row with
 * no calm flag AND no body (a bare state transition, nothing human in it). The
 * derivation is `lib/message-receipt.ts › lifecycleReceiptStatus` — the receipt
 * VOCABULARY the retired page spoke, so "Declined" has one spelling, not two.
 */
export function toReceiptRow(
  message: ChannelMessage,
  formatTime: (iso: string) => string
): ReceiptRow | null {
  const status = lifecycleReceiptStatus(message);
  if (status === null) return null;
  return {
    kind: "receipt",
    id: message.id,
    seq: message.seq,
    status,
    label: RECEIPT_LABEL[status],
    // ⚠ `failed` is the ONE lifecycle status that is not an operator-chosen
    // ending, so it is the only one that may wear alarm ink — the distinction
    // `lib/calm-terminal.ts` exists to preserve.
    calm: status !== "failed",
    time: formatTime(message.createdAt),
  };
}
