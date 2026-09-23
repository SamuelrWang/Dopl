/**
 * Account-wide channel reads across every workspace and home-channel container. Hand-mirrors
 * `src/features/channels/server/service-account.ts` (no drift gate). `workspaceId` on every row is the
 * point: for a home channel it is the container id, published nowhere else (INVARIANTS §4A) — and
 * these rows are not a workspace listing.
 */
import type { ChannelMessage, ChannelSessionStateOwn } from "./channel-types.js";
/** One message addressed to the caller that they have not answered. */
export interface AccountWaitingItem {
    messageId: string;
    seq: number;
    channelId: string;
    threadId: string | null;
    authorUserId: string | null;
    authorName: string | null;
    /** Truncated server-side; never the whole body. */
    preview: string;
    createdAt: string;
    isEscalation: boolean;
    /** Why it is listed (`types-account.ts › AccountWaitingLane`); absent means `person`. */
    lane?: "person" | "desktop" | "likely";
}
/** One channel's line in an account-wide status answer. */
export interface AccountChannelStatus {
    channelId: string;
    channelName: string;
    channelSlug: string;
    /** Workspace id or `link` container id. */
    workspaceId: string;
    lastSeq: number | null;
    lastMessageAt: string | null;
    /** `null` = not asked (no cursor), never zero. */
    unread: number | null;
    sessions: ChannelSessionStateOwn[];
    waiting: AccountWaitingItem[];
}
/** What a clipped read could not see; a count at its ceiling is a floor. */
export interface AccountStatusClips {
    channels: boolean;
    unread: boolean;
    waiting: boolean;
}
export interface AccountStatus {
    channels: AccountChannelStatus[];
    /** Any machine of this operator heartbeating (account-wide, weaker than per-session). */
    operatorOnline: boolean;
    /** Echoed so "0 unread" differs from "asked for none". */
    since: number | null;
    truncated: AccountStatusClips;
}
/** One message on an account-wide page, tagged with where it came from. */
export interface AccountChannelMessage extends ChannelMessage {
    channelName: string;
    channelSlug: string;
    /** The tenancy that owns the channel. */
    workspaceId: string;
}
export interface AccountMessagesPage {
    messages: AccountChannelMessage[];
    /** Reported, so a caller in no channel does not read an empty page as "nothing happened". */
    channelCount: number;
    truncated: boolean;
}
/** `"sessions"` skips the cursor arithmetic; `"full"` (the expensive one) is the default. */
export type AccountStatusView = "full" | "sessions";
export interface AccountStatusOptions {
    /** Global `seq` cursor; absent ⇒ `unread` is `null` on every row. */
    since?: number;
    view?: AccountStatusView;
}
export interface AccountMessagesOptions {
    /** Required: a cursorless account-wide read is a firehose. */
    since: number;
    limit?: number;
}
