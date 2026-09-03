/**
 * **THE ACCOUNT-WIDE STATUS ANSWER, AS A SHAPE** — what `GET
 * /api/channels/account/status` returns, and what `dopl_channel(op="status")`
 * renders.
 *
 * ⚠ **IT IS A `types-*.ts` AND NOT PART OF THE SERVICE, FOR ONE REASON: TWO
 * READERS, AND ONE OF THEM IS A BROWSER.** `server/service-account.ts` opens
 * with `import "server-only"`, so a component that imported its interfaces would
 * fail the bundle — and the Overview "Needs you" card reads exactly these rows
 * (slice B16, when the ping inbox it used to read was deleted). The service
 * re-exports every name below, so nothing that already imported one moved.
 *
 * ⚠ **`waiting` IS THE "NEEDS YOU" LANE NOW.** It is the account-wide answer to
 * *"what has somebody addressed to me that I have not replied to"* — computed
 * from `metadata.to_user_id` against the caller's own later messages
 * (`server/repository-account.ts › listAddressedToMe` and
 * `listMyLatestSeqByChannel`), which is a DERIVED question about the transcript
 * rather than a second mailbox to keep in sync. That is what made deleting the
 * ping table possible without losing the signal.
 */

import type { ChannelSessionStateOwn } from "./types-sessions";

/** One message addressed to the caller that they have not answered. */
export interface AccountWaitingItem {
  messageId: string;
  seq: number;
  channelId: string;
  /** `metadata.taskId` when the message was threaded, else null. */
  threadId: string | null;
  authorUserId: string | null;
  /** Display name or email of the author, null when unresolved. */
  authorName: string | null;
  /** ⚠ Truncated in the SERVICE (§9) — an untruncated body on the wire is the
   *  payload a status read exists to avoid. */
  preview: string;
  createdAt: string;
  /** True when the message carries the reserved `metadata.escalation` payload —
   *  a structured question with option buttons, not an ordinary request. */
  isEscalation: boolean;
}

/** One channel's line in an account-wide status answer. */
export interface AccountChannelStatus {
  channelId: string;
  channelName: string;
  channelSlug: string;
  /** 🔒 The tenancy — a standard workspace id OR a `kind='link'` container id.
   *  This is the value every other tool takes as `workspace=`. */
  workspaceId: string;
  /** Highest seq in the channel, or null when it holds no messages. */
  lastSeq: number | null;
  lastMessageAt: string | null;
  /**
   * Messages past the caller's cursor, excluding their own.
   * ⚠ `null` means NOT ASKED (no `since` was supplied), never zero — §10's
   * telemetry rule applied to a count.
   */
  unread: number | null;
  sessions: ChannelSessionStateOwn[];
  waiting: AccountWaitingItem[];
}

/** What a clipped account read could not see. ⚠ Reported, never rendered as an
 *  absence (§9): a count at its ceiling is a FLOOR, not a measurement. */
export interface AccountStatusClips {
  channels: boolean;
  unread: boolean;
  waiting: boolean;
}

export interface AccountStatus {
  channels: AccountChannelStatus[];
  /** Any machine of this operator's heartbeating — see
   *  `repository-account.ts › presenceAnywhereForUser` for why it is the weaker
   *  account-wide claim rather than the per-workspace one. */
  operatorOnline: boolean;
  /** Echoed back so a caller can tell "0 unread" from "I asked for no cursor". */
  since: number | null;
  truncated: AccountStatusClips;
}
