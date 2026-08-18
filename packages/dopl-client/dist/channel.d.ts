/**
 * Channel methods for `DoplClient`. Free functions over `DoplTransport`.
 *
 * `awaitMessages` is a LONG-POLL: server holds the request open (~50s) for a
 * message with seq > since. ⚠ Longer network timeout, GET auto-retry DISABLED
 * — a retry opens a second poll and can double-count arrivals.
 *
 * ONE call stays bounded at ~50s on purpose: `/api/channels/[id]/await` has
 * maxDuration 60s, so a longer single request is killed mid-flight. A
 * multi-minute hold (WAKE-V1) is assembled ABOVE this layer, in the MCP `await`
 * op, by re-issuing with the same cursor.
 */
import type { DoplTransport } from "./transport.js";
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelCreateInput, ChannelMember, ChannelMessage, ChannelMessageInput, ChannelMessagePosted, ChannelSessionState, ChannelThread, ChannelThreadCloseProposed, ChannelThreadClosed, ChannelThreadCreated, ChannelThreadCreateInput, ChannelThreadPage, ReadMessagesOptions, ThreadMode, ThreadOutcome } from "./channel-types.js";
export declare function listChannels(t: DoplTransport, opts?: {
    includeArchived?: boolean;
}): Promise<Channel[]>;
export declare function getChannel(t: DoplTransport, channelId: string): Promise<Channel>;
export declare function listChannelMembers(t: DoplTransport, channelId: string): Promise<ChannelMember[]>;
export declare function readMessages(t: DoplTransport, channelId: string, opts?: ReadMessagesOptions): Promise<ChannelMessage[]>;
export declare function awaitMessages(t: DoplTransport, channelId: string, opts: AwaitMessagesOptions): Promise<AwaitResult>;
export declare function createChannel(t: DoplTransport, input: ChannelCreateInput): Promise<Channel>;
export declare function inviteToChannel(t: DoplTransport, channelId: string, userId: string): Promise<ChannelMember>;
/**
 * Post a message. `threadClosed` rides in the response ENVELOPE beside the
 * message (like `echoSeq`), not inside it, and is normalized to a boolean HERE:
 * an older deployment sends no key, a post into an open thread sends no key,
 * and both must read `false`, not `undefined` for the caller to re-decide.
 */
export declare function postMessage(t: DoplTransport, channelId: string, input: ChannelMessageInput): Promise<ChannelMessagePosted>;
/**
 * A channel's threads, MOST RECENTLY ACTIVE FIRST — the server's order, which
 * is the only order (`repository-tasks.ts › listTasksByChannel`). ⚠ Do not
 * re-sort: the server's LIMIT clipped against that order, so a re-sorted list is
 * the wrong rows in a plausible order.
 *
 * `truncated` rides through from the envelope; an older server that does not
 * send it reads as `false`, which is the pre-existing behaviour (an unbounded
 * read never clipped), not a claim.
 */
export declare function listChannelThreads(t: DoplTransport, channelId: string): Promise<ChannelThreadPage>;
/**
 * The caller's OWN live sessions. `channelId` narrows to one channel; omitted =
 * all of the caller's in the active workspace. ⚠ Own-scoped server-side — a
 * peer's sessions never come back.
 */
export declare function listChannelSessions(t: DoplTransport, channelId?: string): Promise<ChannelSessionState[]>;
export declare function getChannelThread(t: DoplTransport, channelId: string, threadId: string): Promise<ChannelThread>;
export declare function createChannelThread(t: DoplTransport, channelId: string, input: ChannelThreadCreateInput): Promise<ChannelThreadCreated>;
/**
 * PROPOSE closing a thread — the agent lane's terminal act; agents cannot reach
 * {@link closeChannelThread}. Same route and payload shape, different op: a
 * proposal IS the close it asks a human to confirm, so the confirm hands these
 * two values straight back to `op:"close"`. Writes nothing to the thread row.
 */
export declare function proposeChannelThreadClose(t: DoplTransport, channelId: string, threadId: string, input: {
    outcome: ThreadOutcome;
    summary?: string;
}): Promise<ChannelThreadCloseProposed>;
/**
 * Close a thread. ⚠ HUMAN LANE ONLY — the server refuses an agent-token caller
 * (`ThreadCloseIsHumanOnlyError`); the agent path is
 * {@link proposeChannelThreadClose}. Kept as the one binding for a real route
 * op — a human surface on this client closes through here.
 */
export declare function closeChannelThread(t: DoplTransport, channelId: string, threadId: string, input: {
    outcome: ThreadOutcome;
    summary?: string;
}): Promise<ChannelThreadClosed>;
export declare function setChannelThreadMode(t: DoplTransport, channelId: string, threadId: string, input: {
    mode: ThreadMode;
}): Promise<ChannelThread>;
