/**
 * Channel methods for `DoplClient` — cross-user, agent-to-agent
 * collaboration threads. Free functions over `DoplTransport`; wired into
 * the `DoplClient` class in client.ts.
 *
 * `awaitMessages` is a LONG-POLL: the server holds the request open (up to
 * ~50s) waiting for a message with seq > since. It therefore uses a longer
 * network timeout and disables the transport's GET auto-retry — a retry
 * would open a second poll and could double-count arrivals.
 *
 * ONE call stays bounded at ~50s on purpose: the `/api/channels/[id]/await`
 * route's own maxDuration is 60s, so a longer single request would be killed
 * mid-flight. A multi-minute hold (the WAKE-V1 primitive) is assembled ABOVE
 * this layer, in the MCP `await` op, by re-issuing this call with the same
 * cursor — which keeps the retry ban meaningful: every re-issue is a
 * deliberate, cursor-preserving one, never a blind transport retry.
 */
import type { DoplTransport } from "./transport.js";
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelCreateInput, ChannelMember, ChannelMessage, ChannelMessageInput, ChannelMessagePosted, ChannelThread, ChannelThreadCloseProposed, ChannelThreadClosed, ChannelThreadCreated, ChannelThreadCreateInput, ChannelThreadDetail, ReadMessagesOptions, ThreadMode, ThreadOutcome } from "./channel-types.js";
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
 * Post a message. Resolves the STORED message plus the notices the write raised
 * — today just F6's `threadClosed`, which rides in the response ENVELOPE beside
 * the message (the shape `echoSeq` uses) rather than inside it.
 *
 * `threadClosed` is normalized to a boolean here, and that normalization is the
 * point: an older deployment sends no key, a post into an open thread sends no
 * key, and both must read as `false` rather than as `undefined` for the caller
 * to re-decide. Same additive-field discipline as {@link withParticipants}.
 */
export declare function postMessage(t: DoplTransport, channelId: string, input: ChannelMessageInput): Promise<ChannelMessagePosted>;
export declare function listChannelThreads(t: DoplTransport, channelId: string): Promise<ChannelThreadDetail[]>;
export declare function getChannelThread(t: DoplTransport, channelId: string, threadId: string): Promise<ChannelThreadDetail>;
export declare function createChannelThread(t: DoplTransport, channelId: string, input: ChannelThreadCreateInput): Promise<ChannelThreadCreated>;
/**
 * PROPOSE closing a thread (DECISION 2, 2026-08-04) — the agent lane's terminal
 * act, and the one {@link closeChannelThread} is no longer reachable from.
 *
 * Same route, same payload shape, different op: a proposal IS the close it asks
 * a human to confirm, so the confirm hands these two values straight back to
 * `op:"close"`. It writes nothing to the thread row — see
 * {@link ChannelThreadCloseProposed}.
 */
export declare function proposeChannelThreadClose(t: DoplTransport, channelId: string, threadId: string, input: {
    outcome: ThreadOutcome;
    summary?: string;
}): Promise<ChannelThreadCloseProposed>;
/**
 * Close a thread. HUMAN LANE ONLY since 2026-08-04 — the server refuses an
 * agent-token caller (`ThreadCloseIsHumanOnlyError`), so no MCP op reaches this
 * any more and the agent's path is {@link proposeChannelThreadClose}. Kept
 * because the route op is real and this is its one binding; a human surface
 * built on this client closes through here.
 */
export declare function closeChannelThread(t: DoplTransport, channelId: string, threadId: string, input: {
    outcome: ThreadOutcome;
    summary?: string;
}): Promise<ChannelThreadClosed>;
export declare function setChannelThreadMode(t: DoplTransport, channelId: string, threadId: string, input: {
    mode: ThreadMode;
}): Promise<ChannelThread>;
