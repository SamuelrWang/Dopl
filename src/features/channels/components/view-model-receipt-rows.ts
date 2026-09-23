/** Channels — the lifecycle kinds, and the receipt row a terminal one becomes. */

import {
  RECEIPT_LABEL,
  lifecycleReceiptStatus,
  type ReceiptStatus,
} from "../lib/message-receipt";
import type { ChannelMessage } from "../types";

/** How one exchange ended — no side, avatar or author. `label` is flag-derived
 *  (`lib/message-receipt.ts › RECEIPT_LABEL`), never the caller-controlled body (INVARIANTS §5). */
export interface ReceiptRow {
  kind: "receipt";
  id: string;
  seq: number;
  status: ReceiptStatus;
  label: string;
  /** `false` only for a real `failed` — the one status that may wear alarm ink. */
  calm: boolean;
  time: string;
}


/** Runtime-state kinds: never a bubble, at most a receipt. `task_progress` is absent on purpose:
 *  it is the milestone lane, whose body is prose a peer needs (INVARIANTS §5). */
export function isLifecycleKind(message: ChannelMessage): boolean {
  return (
    message.kind === "task_started" ||
    message.kind === "task_finished" ||
    message.kind === "task_failed"
  );
}

/** A terminal lifecycle row's receipt, or null: always for `task_started` (run state lives in
 *  the Agents tab), and for a terminal row with no calm flag and no body. */
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
    calm: status !== "failed",
    time: formatTime(message.createdAt),
  };
}
