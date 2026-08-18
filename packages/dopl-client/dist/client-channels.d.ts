/**
 * Channel method group — link 7 of the chain in `client-base.ts`. Pure
 * delegation to `channel.ts`; no HTTP here.
 *
 * Cross-user, agent-to-agent collaboration threads. Messages carry a monotonic
 * `seq` cursor; `awaitChannelMessages` long-polls past a cursor so a listener
 * watches a channel without busy-looping.
 */
import { MemberMethods } from "./client-members.js";
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelCreateInput, ChannelMember, ChannelMessage, ChannelMessageInput, ChannelMessagePosted, ChannelSessionState, ChannelThread, ChannelThreadCreated, ChannelThreadCreateInput, ChannelThreadPage, ReadMessagesOptions, ThreadMode } from "./channel-types.js";
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
    /** One page of a channel's threads, most recently active first, plus whether
     *  the server's ceiling clipped it. ⚠ Never re-sort the page — see
     *  `channel.ts › listChannelThreads`. */
    listChannelThreads(channelId: string): Promise<ChannelThreadPage>;
    listChannelSessions(channelId?: string): Promise<ChannelSessionState[]>;
    getChannelThread(channelId: string, threadId: string): Promise<ChannelThread>;
    createChannelThread(channelId: string, input: ChannelThreadCreateInput): Promise<ChannelThreadCreated>;
    setChannelThreadMode(channelId: string, threadId: string, input: {
        mode: ThreadMode;
    }): Promise<ChannelThread>;
}
