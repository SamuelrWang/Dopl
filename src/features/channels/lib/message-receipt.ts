/**
 * THE RECEIPT VOCABULARY — what a transcript may say about how an exchange
 * ended, and the two derivations that produce it.
 *
 * 1. {@link deriveMessageReceipt} — the status line for MY own outgoing human
 *    message, derived from the thread events that follow it.
 * 2. {@link lifecycleReceiptStatus} — the status of ONE terminal lifecycle row,
 *    read off that row alone. This is what `components/channels-v2/view-model.ts`
 *    renders as the transcript's slim muted receipt line.
 *
 * ⚠ **THIS MODULE WAS ORPHANED BETWEEN 2026-08-18 (Phase 5) AND THE WAVE-2 FIX
 * PASS, AND THAT WAS THE BUG.** Phase 5 deleted the session card that consumed
 * it and Phase 12's reader dropped every lifecycle kind on sight, so a consent
 * DENY — `task_failed{declined:true}`, still posted by `main/trigger-outcomes.js`
 * on THIS build — rendered as nothing at all. The vocabulary was kept at P5 for
 * exactly this re-use; (2) is what re-uses it.
 *
 * ⚠ NO writes, NO acks, and deliberately NO "Received"/"Read": the desktop does
 * not ack a delivery, so claiming one is a lie. Reports only what the transcript
 * proves.
 *
 * ⚠ EVERY MESSAGE RENDERS STANDALONE NOW. This used to note that a message with
 * an explicit `metadata.taskId` grouped into a session card and so never reached
 * this line; the card and its grouper are DELETED (wiring plan Phase 5,
 * 2026-08-18), so the task-linked shape is live rather than merely unit-tested.
 *
 * Pure + deterministic. Its terminal-wins precedence used to MIRROR the grouper's
 * `computeStatus`; with that gone this is the only statement of it left, and
 * {@link calmTerminalStatus} (`lib/calm-terminal.ts`, rehomed in the same change)
 * is what makes the flag reads strictly `=== true`. ⚠ Linkage by the DERIVABLE legacy `task-{channelId}-{seq}` id is
 * party-scoped (step 3) so only the two people in the exchange move my receipt.
 */

import type { ChannelMessage } from "../types";
import { calmTerminalStatus } from "./calm-terminal";

/**
 * ⚠ `capped` / `ended` / `finished` are produced ONLY by
 * {@link lifecycleReceiptStatus}. {@link deriveMessageReceipt} cannot return
 * them — it reports on MY outgoing ask, and those three are statements about
 * how a RUN stopped, which is a different question. One union because it is one
 * vocabulary: a second enum is how two spellings of "Declined" get shipped.
 */
export type ReceiptStatus =
  | "sent"
  | "working"
  | "replied"
  | "declined"
  | "failed"
  | "interrupted"
  | "dropped"
  | "capped"
  | "ended"
  | "finished";

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
 * Receipt for MY outgoing human message, derived from later thread events.
 * Null when none should show (not my message, or an unaddressed broadcast).
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

  // 2. An unaddressed broadcast never routed to anyone — nothing to report.
  const toUser = metaToUserId(message);
  const taskId = metaTaskId(message);
  if (toUser === null && taskId === null) return null;

  // 3. The deterministic legacy id the desktop spawner would mint for a task
  //    opened by THIS message, plus who is entitled to speak on it.
  //
  //    ⚠ That id is DERIVABLE by any channel member (the DTO exposes `seq`) and
  //    the server does NOT gate a non-UUID `taskId` on participation, so string
  //    equality alone lets a third member stamp a red "Failed" or a fake
  //    "Replied" onto someone else's request. A legacy exchange has exactly two
  //    parties: me, and the addressee whose desktop mints the id. ⚠ Client-side
  //    render defence only — the row is still stored.
  const legacyId = `task-${message.channelId}-${message.seq}`;
  const isExchangeParty = (m: ChannelMessage): boolean =>
    m.authorUserId !== null &&
    (m.authorUserId === currentUserId || m.authorUserId === toUser);

  // 4. Later events linked to this message: shared explicit task id, the legacy
  //    deterministic id, or an addressed agent reply back to me (the pair-reply
  //    a terminal-mode session self-posts without a task id).
  //    ⚠ The no-taskId pair-reply binds to the NEAREST PRECEDING ask — without
  //    that scoping one reply lights up "Replied" on every stacked ask before it.
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

  // 5. Terminal-wins precedence, mirroring `computeStatus`: a calm ending or a
  //    real failure beats a delivered reply, which beats a bare "started".
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

/**
 * THE TRANSCRIPT'S LIFECYCLE RECEIPT — the status one terminal row announces,
 * or null when the row is machine noise the reader should drop.
 *
 * ⚠ **`task_started` IS NEVER A RECEIPT.** "Started working on this request." is
 * a fact about a runtime, and an agent's run state lives in the Agents tab, not
 * as transcript rows (INVARIANTS §5, MAPPING.md § Q&A rulings). Only the two
 * TERMINAL kinds can produce a line, because only an ending changes how the
 * peer reads the exchange: an unanswered ask and a DECLINED one look identical
 * without it.
 *
 * ⚠ **STATUS COMES FROM THE FLAG, NEVER FROM THE BODY COPY** — the same rule
 * `lib/calm-terminal.ts` states, and for the same reason: matching body text
 * regresses the first time somebody improves the wording, and `metadata` is
 * strict `=== true` so a truthy-but-not-true value cannot disguise a real
 * failure as a calm ending. The BODY is consulted for exactly one thing: whether
 * the row says anything at all. A flagless terminal row with an empty body is a
 * bare state transition with no human content, and it stays dropped.
 */
export function lifecycleReceiptStatus(
  message: ChannelMessage,
): ReceiptStatus | null {
  if (message.kind !== "task_failed" && message.kind !== "task_finished") {
    return null;
  }
  const calm = calmTerminalStatus(message);
  if (calm !== null) return calm;
  if (message.body.trim().length === 0) return null;
  return message.kind === "task_finished" ? "finished" : "failed";
}

/** Label for a receipt status. ⚠ No fabricated acks. */
export const RECEIPT_LABEL: Record<ReceiptStatus, string> = {
  sent: "Sent",
  working: "Accepted, agent working",
  replied: "Replied",
  declined: "Declined",
  failed: "Failed",
  interrupted: "Interrupted",
  dropped: "Reply not sent",
  capped: "Stopped at its limit",
  ended: "Ended by the operator",
  finished: "Finished",
};

/** Calm receipt terminals — operator-chosen endings keeping the muted chip
 *  treatment, ⚠ never the alarm ink of a real `failed`. Mirrors
 *  `lib/calm-terminal.ts › CalmTerminalStatus` exactly; `finished` is absent
 *  because it is a plain success, not an ending somebody chose. */
const CALM_RECEIPT_STATUSES: ReadonlySet<ReceiptStatus> = new Set([
  "declined",
  "dropped",
  "interrupted",
  "capped",
  "ended",
]);

/** True for the calm receipt terminals (declined/dropped/interrupted/capped/ended). */
export function isCalmReceiptStatus(status: ReceiptStatus): boolean {
  return CALM_RECEIPT_STATUSES.has(status);
}
