/**
 * Message receipt — a client-side status line for MY own outgoing human
 * message, derived purely from the thread events that follow it. There are NO
 * writes, NO acks, and deliberately NO "Received"/"Read" status: the desktop
 * does not ack a delivery, so claiming one would be a lie. The receipt reports
 * only what the transcript already proves — that a linked task started, a reply
 * landed, or the request reached a terminal outcome.
 *
 * A message with an explicit `metadata.taskId` groups into a {@link SessionCard}
 * and is never rendered as a standalone bubble, so in practice the receipt is
 * only shown for an ADDRESSED no-task message; the function still handles the
 * task-linked shape so it can be unit-tested in isolation.
 *
 * Pure + deterministic. Mirrors the terminal-wins precedence of
 * `group-thread.computeStatus`, and reuses {@link calmTerminalStatus} for the
 * strict (`=== true`) calm-flag checks so a truthy-not-true flag can never
 * disguise a real failure as a calm outcome. Linkage by the DERIVABLE legacy
 * `task-{channelId}-{seq}` id is additionally party-scoped, so only the two
 * people actually in the exchange can move my receipt (see step 3).
 */

import type { ChannelMessage } from "../types";
import { calmTerminalStatus } from "./group-thread";

export type ReceiptStatus =
  | "sent"
  | "working"
  | "replied"
  | "declined"
  | "failed"
  | "interrupted"
  | "dropped";

/** The addressed recipient of a message (`metadata.to_user_id`), or null. */
function metaToUserId(message: ChannelMessage): string | null {
  const value = message.metadata.to_user_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The bound task id of a message (`metadata.taskId`), or null. */
function metaTaskId(message: ChannelMessage): string | null {
  const value = message.metadata.taskId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Client-side receipt for MY outgoing human message, derived from later thread
 * events. No writes, no acks. Returns null when no receipt should show (not my
 * message, or an unaddressed broadcast that never routed to anyone).
 */
export function deriveMessageReceipt(
  message: ChannelMessage,
  messages: ChannelMessage[],
  currentUserId: string,
): ReceiptStatus | null {
  // 1. Only MY own human message gets a receipt.
  if (message.authorKind !== "user" || message.authorUserId !== currentUserId) {
    return null;
  }

  // 2. An unaddressed broadcast (no recipient, no task) never routed to anyone,
  //    so there is nothing to report a receipt against.
  const toUser = metaToUserId(message);
  const taskId = metaTaskId(message);
  if (toUser === null && taskId === null) return null;

  // 3. The deterministic legacy id the desktop spawner would mint for a task
  //    opened by THIS message (`task-{channelId}-{seq}`), plus the check of who
  //    is entitled to speak on it.
  //
  //    That id is DERIVABLE by any channel member — the message DTO exposes
  //    `seq` — and the server does NOT gate a non-UUID `taskId` on participation
  //    (F-083; closing it server-side is product decision P2). So matching on
  //    string equality alone let any third member stamp a red "Failed", or a
  //    fake "Replied"/"Accepted, agent working", onto someone else's request.
  //    A legacy exchange has exactly two parties: me, and the addressee whose
  //    desktop mints the id (`trigger.js:129`). Anyone else claiming it is not
  //    in this exchange and is ignored here. Client-side render defense only —
  //    the row is still stored, and the server-side gate is still P2.
  const legacyId = `task-${message.channelId}-${message.seq}`;
  const isExchangeParty = (m: ChannelMessage): boolean =>
    m.authorUserId !== null &&
    (m.authorUserId === currentUserId || m.authorUserId === toUser);

  // 4. Later events linked to this message: by shared explicit task id, by the
  //    legacy deterministic id, or as an addressed agent reply back to me (the
  //    pair-reply a terminal-mode session self-posts without a task id).
  //    The no-taskId pair-reply binds to the NEAREST PRECEDING ask: if I sent
  //    the same peer another ask between this message and the reply, the reply
  //    answers that later ask, not this one — without this scoping, one reply
  //    would light up "Replied" on every stacked ask before it.
  const linked = messages.filter((m) => {
    if (m.seq <= message.seq) return false;
    const mTask = metaTaskId(m);
    if (taskId !== null && mTask === taskId) return true;
    if (mTask === legacyId && isExchangeParty(m)) return true;
    return (
      toUser !== null &&
      m.kind === "message" &&
      m.authorKind === "agent" &&
      m.authorUserId === toUser &&
      metaToUserId(m) === currentUserId &&
      !messages.some(
        (x) =>
          x.seq > message.seq &&
          x.seq < m.seq &&
          x.kind === "message" &&
          x.authorKind === "user" &&
          x.authorUserId === currentUserId &&
          metaToUserId(x) === toUser,
      )
    );
  });

  // 5. Terminal-wins precedence over the linked events, mirroring
  //    `computeStatus`: a calm operator-chosen ending or a real failure beats a
  //    delivered reply, which beats a bare "started".
  if (linked.some((m) => calmTerminalStatus(m) === "declined")) return "declined";
  if (linked.some((m) => calmTerminalStatus(m) === "dropped")) return "dropped";
  if (linked.some((m) => calmTerminalStatus(m) === "interrupted")) {
    return "interrupted";
  }
  if (linked.some((m) => m.kind === "task_failed" && calmTerminalStatus(m) === null)) {
    return "failed";
  }
  if (
    linked.some(
      (m) =>
        (m.kind === "message" && m.authorKind === "agent") ||
        m.kind === "task_finished",
    )
  ) {
    return "replied";
  }
  if (linked.some((m) => m.kind === "task_started")) return "working";
  return "sent";
}

/** Human-readable label for a receipt status. No em dashes, no fabricated acks. */
export const RECEIPT_LABEL: Record<ReceiptStatus, string> = {
  sent: "Sent",
  working: "Accepted, agent working",
  replied: "Replied",
  declined: "Declined",
  failed: "Failed",
  interrupted: "Interrupted",
  dropped: "Reply not sent",
};

/**
 * The calm receipt terminals — operator-chosen endings that keep the muted chip
 * treatment (never the alarm ink of a real `failed`).
 */
const CALM_RECEIPT_STATUSES: ReadonlySet<ReceiptStatus> = new Set([
  "declined",
  "dropped",
  "interrupted",
]);

/** True for the calm receipt terminals (declined/dropped/interrupted). */
export function isCalmReceiptStatus(status: ReceiptStatus): boolean {
  return CALM_RECEIPT_STATUSES.has(status);
}
