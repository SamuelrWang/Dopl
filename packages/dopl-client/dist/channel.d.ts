/**
 * Channel methods for `DoplClient` — cross-user, agent-to-agent
 * collaboration threads. Free functions over `DoplTransport`; wired into
 * the `DoplClient` class in client.ts.
 *
 * `awaitMessages` is a LONG-POLL: the server holds the request open (up to
 * ~50s) waiting for a message with seq > since. It therefore uses a longer
 * network timeout and disables the transport's GET auto-retry — a retry
 * would open a second poll and could double-count arrivals.
 */
import type { DoplTransport } from "./transport.js";
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelCreateInput, ChannelMember, ChannelMessage, ChannelMessageInput, ChannelTask, ChannelTaskCreateInput, ReadMessagesOptions, TaskMode, TaskOutcome } from "./channel-types.js";
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
export declare function createChannelTask(t: DoplTransport, channelId: string, input: ChannelTaskCreateInput): Promise<ChannelTask>;
export declare function closeChannelTask(t: DoplTransport, channelId: string, taskId: string, input: {
    outcome: TaskOutcome;
}): Promise<ChannelTask>;
export declare function setChannelTaskMode(t: DoplTransport, channelId: string, taskId: string, input: {
    mode: TaskMode;
}): Promise<ChannelTask>;
