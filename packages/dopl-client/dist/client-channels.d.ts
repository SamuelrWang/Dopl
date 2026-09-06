/**
 * Channel method group — link 7 of the chain in `client-base.ts`. Pure
 * delegation to `channel.ts`; no HTTP here.
 *
 * Cross-user, agent-to-agent collaboration threads. Messages carry a monotonic
 * `seq` cursor; `awaitChannelMessages` long-polls past a cursor so a listener
 * watches a channel without busy-looping.
 */
import { MemberMethods } from "./client-members.js";
import type { AccountMessagesOptions, AccountMessagesPage, AccountStatus, AccountStatusOptions } from "./account-types.js";
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelArtifact, ChannelArtifactAction, ChannelArtifactResult, ChannelCreateInput, ChannelUpdateInput, ChannelMember, ChannelMessage, ChannelMessageInput, ChannelMessagePosted, ChannelReadEntry, ChannelSessionsPage, ChannelThread, ChannelThreadCreated, ChannelThreadCreateInput, ChannelThreadPage, ReadMessagesOptions, ThreadMode, WorkspaceAwaitResult } from "./channel-types.js";
import type { AgentDirectiveCreateInput, AgentDirectiveCreated, LaunchDirective, LaunchDirectiveCreateInput, LaunchDirectiveCreated } from "./launch-types.js";
import type { AgentDirection, AgentDirectionCreateInput, AgentDirectionCreated } from "./direction-types.js";
export declare class ChannelMethods extends MemberMethods {
    listChannels(opts?: {
        includeArchived?: boolean;
    }): Promise<Channel[]>;
    /**
     * ⚠ ACCOUNT-WIDE AND USER-SCOPED — every channel the caller is in, across
     * every workspace AND every home-channel container. It ENUMERATES and is not
     * narrowed here; see `channel-account.ts`'s header for the container-lock
     * caveat that applies to both of these.
     */
    getAccountStatus(opts?: AccountStatusOptions): Promise<AccountStatus>;
    readAccountMessages(opts: AccountMessagesOptions): Promise<AccountMessagesPage>;
    getChannel(channelId: string): Promise<Channel>;
    createChannel(input: ChannelCreateInput): Promise<Channel>;
    /** ⚠ `infoCard` ONLY — see `channel.ts › updateChannel` for why the other
     *  four fields of that PATCH are deliberately unbound. */
    updateChannel(channelId: string, patch: ChannelUpdateInput): Promise<Channel>;
    listChannelMembers(channelId: string): Promise<ChannelMember[]>;
    inviteToChannel(channelId: string, userId: string): Promise<ChannelMember>;
    readChannelMessages(channelId: string, opts?: ReadMessagesOptions): Promise<ChannelMessage[]>;
    postChannelMessage(channelId: string, input: ChannelMessageInput): Promise<ChannelMessagePosted>;
    /**
     * THE FOLDED READ (#1220 §4, 2026-09-06). ⚠ `entries === null` means nothing
     * on the page is in an artifact — the same handling an older server gets.
     * {@link readChannelMessages} is unchanged and is what artifact-unaware
     * callers keep using.
     */
    readChannelTranscript(channelId: string, opts?: ReadMessagesOptions): Promise<{
        messages: ChannelMessage[];
        entries: ChannelReadEntry[] | null;
    }>;
    /** ⚠ `folded` may be SHORTER than `requested`; report it, never a count. */
    writeChannelArtifact(channelId: string, input: ChannelArtifactAction): Promise<ChannelArtifactResult>;
    readChannelArtifact(channelId: string, artifactId: string): Promise<{
        artifact: ChannelArtifact;
        messages: ChannelMessage[];
        truncated: boolean;
    }>;
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
    /** END or RENAME one of the operator's OWN running agents (2026-09-01).
     *  ⚠ THE SAME MAILBOX as a launch, a different `kind` — so the answer is a
     *  `LaunchDirective` and `getLaunchDirective` polls it. ⚠ No launch toggle
     *  applies to these two; do not tell a caller to turn one on. */
    createAgentDirective(input: AgentDirectiveCreateInput): Promise<AgentDirectiveCreated>;
    /** Poll one launch directive. ⚠ Coarse (1-2s) — see `channel.ts`. */
    getLaunchDirective(id: string): Promise<LaunchDirective>;
    /** DIRECT one of the operator's OWN running agents, privately (2026-08-31).
     *  ⚠ A REQUEST like a launch: the machine may refuse with one of five words,
     *  and `offline: true` means nothing was even filed. There is no operator
     *  argument, deliberately — the server stamps the authenticated caller. */
    createAgentDirection(input: AgentDirectionCreateInput): Promise<AgentDirectionCreated>;
    /** Poll one direction — where the directed turn's final text comes back. */
    getAgentDirection(id: string): Promise<AgentDirection>;
    /** The caller's own recent directions, terminal rows included. */
    listAgentDirections(query?: {
        channel?: string;
        agent?: string;
    }): Promise<AgentDirection[]>;
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
