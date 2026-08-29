/**
 * Channel method group — link 7 of the chain in `client-base.ts`. Pure
 * delegation to `channel.ts`; no HTTP here.
 *
 * Cross-user, agent-to-agent collaboration threads. Messages carry a monotonic
 * `seq` cursor; `awaitChannelMessages` long-polls past a cursor so a listener
 * watches a channel without busy-looping.
 */
import { MemberMethods } from "./client-members.js";
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelCreateInput, ChannelUpdateInput, ChannelMember, ChannelMessage, ChannelMessageInput, ChannelMessagePosted, ChannelSessionsPage, ChannelThread, ChannelThreadCreated, ChannelThreadCreateInput, ChannelThreadPage, ReadMessagesOptions, ThreadMode, WorkspaceAwaitResult } from "./channel-types.js";
import type { LaunchDirective, LaunchDirectiveCreateInput, LaunchDirectiveCreated } from "./launch-types.js";
export declare class ChannelMethods extends MemberMethods {
    listChannels(opts?: {
        includeArchived?: boolean;
    }): Promise<Channel[]>;
    getChannel(channelId: string): Promise<Channel>;
    createChannel(input: ChannelCreateInput): Promise<Channel>;
    /** ⚠ `infoCard` ONLY — see `channel.ts › updateChannel` for why the other
     *  four fields of that PATCH are deliberately unbound. */
    updateChannel(channelId: string, patch: ChannelUpdateInput): Promise<Channel>;
    listChannelMembers(channelId: string): Promise<ChannelMember[]>;
    inviteToChannel(channelId: string, userId: string): Promise<ChannelMember>;
    readChannelMessages(channelId: string, opts?: ReadMessagesOptions): Promise<ChannelMessage[]>;
    postChannelMessage(channelId: string, input: ChannelMessageInput): Promise<ChannelMessagePosted>;
    awaitChannelMessages(channelId: string, opts: AwaitMessagesOptions): Promise<AwaitResult>;
    /** One page of a channel's threads, most recently active first, plus whether
     *  the server's ceiling clipped it. ⚠ Never re-sort the page — see
     *  `channel.ts › listChannelThreads`. */
    /** WORKSPACE-WIDE long-poll — every channel the caller is a MEMBER of, one
     *  cursor (`seq` is workspace-global). ⚠ Narrower than a channel READ: a public
     *  channel the caller never joined is not watched. */
    awaitWorkspaceMessages(opts: AwaitMessagesOptions): Promise<WorkspaceAwaitResult>;
    listChannelThreads(channelId: string): Promise<ChannelThreadPage>;
    /** The caller's OWN sessions, telemetry included — own-scoped at the server. */
    /** Ask the operator's OWN desktop to start an agent. ⚠ A REQUEST — the machine
     *  may refuse with one of six words, and `offline: true` means nothing was
     *  even filed. There is no operator argument, deliberately. */
    createLaunchDirective(input: LaunchDirectiveCreateInput): Promise<LaunchDirectiveCreated>;
    /** Poll one launch directive. ⚠ Coarse (1-2s) — see `channel.ts`. */
    getLaunchDirective(id: string): Promise<LaunchDirective>;
    /** ⚠ A PAGE since 2026-08-23 (F-294), not a bare array: `operatorOnline`
     *  rides beside the rows because presence is a fact about the MACHINE, not
     *  about any one session. See `channel-types.ts › ChannelSessionsPage`. */
    listChannelSessions(channelId?: string): Promise<ChannelSessionsPage>;
    getChannelThread(channelId: string, threadId: string): Promise<ChannelThread>;
    createChannelThread(channelId: string, input: ChannelThreadCreateInput): Promise<ChannelThreadCreated>;
    setChannelThreadMode(channelId: string, threadId: string, input: {
        mode: ThreadMode;
    }): Promise<ChannelThread>;
}
