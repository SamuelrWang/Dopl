/**
 * Domain types for the ACCOUNT-WIDE channel reads — one answer across every
 * workspace AND every home-channel container the caller belongs to.
 *
 * ⚠ Mirrors `src/features/channels/server/service-account.ts` — hand-synced,
 * like `home-types.ts` and `agent-template-types.ts`. No drift gate covers this
 * pair; both halves move in ONE change.
 *
 * 🔒 **`workspaceId` ON EVERY ROW IS THE POINT OF THESE TYPES.** A page that
 * spans tenancies is unusable without saying which tenancy each row came from —
 * it is the handle every other tool takes as `workspace=`, and for a home
 * channel it is the CONTAINER id, which no listing publishes (INVARIANTS §4A).
 *
 * ⚠ **THESE ARE NOT A WORKSPACE LISTING AND MUST NOT BE RENDERED AS ONE.** A row
 * whose `workspaceId` names a `kind='link'` container is a HOME CHANNEL to the
 * operator; a surface that calls it a workspace has advertised a container as a
 * tenancy, which §4A forbids everywhere.
 */

import type { ChannelMessage, ChannelSessionStateOwn } from "./channel-types.js";

/** One message addressed to the caller that they have not answered. */
export interface AccountWaitingItem {
  messageId: string;
  seq: number;
  channelId: string;
  /** `metadata.taskId` when the message was threaded, else null. */
  threadId: string | null;
  authorUserId: string | null;
  authorName: string | null;
  /** ⚠ Pre-truncated SERVER-SIDE. Never the whole body. */
  preview: string;
  createdAt: string;
  /** The message carries a structured escalation card, not an ordinary request. */
  isEscalation: boolean;
}

/** One channel's line in an account-wide status answer. */
export interface AccountChannelStatus {
  channelId: string;
  channelName: string;
  channelSlug: string;
  /** 🔒 Standard workspace id OR `kind='link'` container id — the `workspace=`
   *  handle for every other tool. */
  workspaceId: string;
  /** Highest seq in the channel, or null when it holds no messages. */
  lastSeq: number | null;
  lastMessageAt: string | null;
  /** ⚠ `null` = NOT ASKED (no cursor was supplied), never zero. */
  unread: number | null;
  sessions: ChannelSessionStateOwn[];
  waiting: AccountWaitingItem[];
}

/** What a clipped account read could not see. ⚠ A count at its ceiling is a
 *  FLOOR, and a renderer that hides these reports a clip as an absence. */
export interface AccountStatusClips {
  channels: boolean;
  unread: boolean;
  waiting: boolean;
}

export interface AccountStatus {
  channels: AccountChannelStatus[];
  /** Any machine of this operator's heartbeating — the weaker ACCOUNT-wide
   *  claim, which only ever softens a quiet session row into "unchanged". */
  operatorOnline: boolean;
  /** Echoed back, so "0 unread" stays distinguishable from "I asked for none". */
  since: number | null;
  truncated: AccountStatusClips;
}

/** One message on an account-wide page, tagged with where it came from. */
export interface AccountChannelMessage extends ChannelMessage {
  channelName: string;
  channelSlug: string;
  /** 🔒 The tenancy that owns the channel — the `workspace=` handle. */
  workspaceId: string;
}

export interface AccountMessagesPage {
  messages: AccountChannelMessage[];
  /** ⚠ REPORTED, never inferred: a caller who belongs to NO channel would
   *  otherwise read an empty page as "nothing happened". */
  channelCount: number;
  truncated: boolean;
}

/** ⚠ A VIEW IS A PARAMETER AND THE EXPENSIVE ONE IS THE DEFAULT. `"sessions"`
 *  skips the cursor arithmetic for the all-sessions read. */
export type AccountStatusView = "full" | "sessions";

export interface AccountStatusOptions {
  /** Global `seq` cursor. Absent ⇒ `unread` is `null` on every row. */
  since?: number;
  view?: AccountStatusView;
}

export interface AccountMessagesOptions {
  /** ⚠ REQUIRED. A cursorless account-wide read is a firehose across every
   *  tenancy the caller belongs to. */
  since: number;
  limit?: number;
}
