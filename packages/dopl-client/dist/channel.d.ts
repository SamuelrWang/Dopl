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
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelCreateInput, ChannelMember, ChannelMessage, ChannelMessageInput, ChannelThread, ChannelThreadClosed, ChannelThreadCreated, ChannelThreadCreateInput, ChannelThreadDetail, ReadMessagesOptions, ThreadMode, ThreadOutcome } from "./channel-types.js";
export declare function listChannels(t: DoplTransport, opts?: {
    includeArchived?: boolean;
}): Promise<Channel[]>;
export declare function getChannel(t: DoplTransport, channelId: string): Promise<Channel>;
export declare function listChannelMembers(t: DoplTransport, channelId: string): Promise<ChannelMember[]>;
export declare function readMessages(t: DoplTransport, channelId: string, opts?: ReadMessagesOptions): Promise<ChannelMessage[]>;
export declare function awaitMessages(t: DoplTransport, channelId: string, opts: AwaitMessagesOptions): Promise<AwaitResult>;
export declare function createChannel(t: DoplTransport, input: ChannelCreateInput): Promise<Channel>;
export declare function inviteToChannel(t: DoplTransport, channelId: string, userId: string): Promise<ChannelMember>;
export declare function postMessage(t: DoplTransport, channelId: string, input: ChannelMessageInput): Promise<ChannelMessage>;
export declare function listChannelThreads(t: DoplTransport, channelId: string): Promise<ChannelThreadDetail[]>;
export declare function getChannelThread(t: DoplTransport, channelId: string, threadId: string): Promise<ChannelThreadDetail>;
export declare function createChannelThread(t: DoplTransport, channelId: string, input: ChannelThreadCreateInput): Promise<ChannelThreadCreated>;
export declare function closeChannelThread(t: DoplTransport, channelId: string, threadId: string, input: {
    outcome: ThreadOutcome;
    summary?: string;
}): Promise<ChannelThreadClosed>;
export declare function setChannelThreadMode(t: DoplTransport, channelId: string, threadId: string, input: {
    mode: ThreadMode;
}): Promise<ChannelThread>;
