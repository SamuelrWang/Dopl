/**
 * Channel method group — link 7 of the chain documented in `client-base.ts`.
 * Pure delegation to `channel.ts`; no HTTP here.
 *
 * Cross-user, agent-to-agent collaboration threads. Messages carry a
 * monotonic `seq` cursor; `awaitChannelMessages` long-polls for arrivals past
 * a cursor so a listener can watch a channel without busy-looping. There was
 * a MULTIPLAYER half — channel agents + thread participants — and it is gone
 * with the surfaces it called (channels rollback §1).
 */
import { MemberMethods } from "./client-members.js";
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelCreateInput, ChannelMember, ChannelMessage, ChannelMessageInput, ChannelMessagePosted, ChannelSessionState, ChannelThread, ChannelThreadCloseProposed, ChannelThreadClosed, ChannelThreadCreated, ChannelThreadCreateInput, ReadMessagesOptions, ThreadMode, ThreadOutcome } from "./channel-types.js";
export declare class ChannelMethods extends MemberMethods {
    listChannels(opts?: {
        includeArchived?: boolean;
    }): Promise<Channel[]>;
    getChannel(channelId: string): Promise<Channel>;
    createChannel(input: ChannelCreateInput): Promise<Channel>;
    listChannelMembers(channelId: string): Promise<ChannelMember[]>;
    inviteToChannel(channelId: string, userId: string): Promise<ChannelMember>;
    readChannelMessages(channelId: string, opts?: ReadMessagesOptions): Promise<ChannelMessage[]>;
    postChannelMessage(channelId: string, input: ChannelMessageInput): Promise<ChannelMessagePosted>;
    awaitChannelMessages(channelId: string, opts: AwaitMessagesOptions): Promise<AwaitResult>;
    listChannelThreads(channelId: string): Promise<ChannelThread[]>;
    listChannelSessions(channelId?: string): Promise<ChannelSessionState[]>;
    getChannelThread(channelId: string, threadId: string): Promise<ChannelThread>;
    createChannelThread(channelId: string, input: ChannelThreadCreateInput): Promise<ChannelThreadCreated>;
    closeChannelThread(channelId: string, threadId: string, input: {
        outcome: ThreadOutcome;
        summary?: string;
    }): Promise<ChannelThreadClosed>;
    /**
     * DECISION 2 (2026-08-04) — the agent lane's terminal act on a thread. See
     * `channel.proposeChannelThreadClose`; `closeChannelThread` above is the human
     * lane and the server refuses it for an agent token.
     */
    proposeChannelThreadClose(channelId: string, threadId: string, input: {
        outcome: ThreadOutcome;
        summary?: string;
    }): Promise<ChannelThreadCloseProposed>;
    setChannelThreadMode(channelId: string, threadId: string, input: {
        mode: ThreadMode;
    }): Promise<ChannelThread>;
}
