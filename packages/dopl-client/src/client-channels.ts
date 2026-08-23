/**
 * Channel method group — link 7 of the chain in `client-base.ts`. Pure
 * delegation to `channel.ts`; no HTTP here.
 *
 * Cross-user, agent-to-agent collaboration threads. Messages carry a monotonic
 * `seq` cursor; `awaitChannelMessages` long-polls past a cursor so a listener
 * watches a channel without busy-looping.
 */

import { MemberMethods } from "./client-members.js";
import * as channel from "./channel.js";
import type {
  AwaitMessagesOptions,
  AwaitResult,
  Channel,
  ChannelCreateInput,
  ChannelMember,
  ChannelMessage,
  ChannelMessageInput,
  ChannelMessagePosted,
  ChannelSessionStateOwn,
  ChannelThread,
  ChannelThreadCreated,
  ChannelThreadCreateInput,
  ChannelThreadPage,
  ReadMessagesOptions,
  ThreadMode,
  WorkspaceAwaitResult,
} from "./channel-types.js";
import type {
  LaunchDirective,
  LaunchDirectiveCreateInput,
  LaunchDirectiveCreated,
} from "./launch-types.js";

export class ChannelMethods extends MemberMethods {
  listChannels(opts?: { includeArchived?: boolean }): Promise<Channel[]> {
    return channel.listChannels(this.transport, opts);
  }

  getChannel(channelId: string): Promise<Channel> {
    return channel.getChannel(this.transport, channelId);
  }

  createChannel(input: ChannelCreateInput): Promise<Channel> {
    return channel.createChannel(this.transport, input);
  }

  listChannelMembers(channelId: string): Promise<ChannelMember[]> {
    return channel.listChannelMembers(this.transport, channelId);
  }

  inviteToChannel(channelId: string, userId: string): Promise<ChannelMember> {
    return channel.inviteToChannel(this.transport, channelId, userId);
  }

  readChannelMessages(
    channelId: string,
    opts?: ReadMessagesOptions
  ): Promise<ChannelMessage[]> {
    return channel.readMessages(this.transport, channelId, opts);
  }

  postChannelMessage(
    channelId: string,
    input: ChannelMessageInput
  ): Promise<ChannelMessagePosted> {
    return channel.postMessage(this.transport, channelId, input);
  }

  awaitChannelMessages(
    channelId: string,
    opts: AwaitMessagesOptions
  ): Promise<AwaitResult> {
    return channel.awaitMessages(this.transport, channelId, opts);
  }

  /** One page of a channel's threads, most recently active first, plus whether
   *  the server's ceiling clipped it. ⚠ Never re-sort the page — see
   *  `channel.ts › listChannelThreads`. */
  /** WORKSPACE-WIDE long-poll — every channel the caller is a MEMBER of, one
   *  cursor (`seq` is workspace-global). ⚠ Narrower than a channel READ: a public
   *  channel the caller never joined is not watched. */
  awaitWorkspaceMessages(opts: AwaitMessagesOptions): Promise<WorkspaceAwaitResult> {
    return channel.awaitWorkspaceMessages(this.transport, opts);
  }

  listChannelThreads(channelId: string): Promise<ChannelThreadPage> {
    return channel.listChannelThreads(this.transport, channelId);
  }

  /** The caller's OWN sessions, telemetry included — own-scoped at the server. */
  /** Ask the operator's OWN desktop to start an agent. ⚠ A REQUEST — the machine
   *  may refuse with one of six words, and `offline: true` means nothing was
   *  even filed. There is no operator argument, deliberately. */
  createLaunchDirective(
    input: LaunchDirectiveCreateInput
  ): Promise<LaunchDirectiveCreated> {
    return channel.createLaunchDirective(this.transport, input);
  }

  /** Poll one launch directive. ⚠ Coarse (1-2s) — see `channel.ts`. */
  getLaunchDirective(id: string): Promise<LaunchDirective> {
    return channel.getLaunchDirective(this.transport, id);
  }

  listChannelSessions(channelId?: string): Promise<ChannelSessionStateOwn[]> {
    return channel.listChannelSessions(this.transport, channelId);
  }

  getChannelThread(channelId: string, threadId: string): Promise<ChannelThread> {
    return channel.getChannelThread(this.transport, channelId, threadId);
  }

  createChannelThread(
    channelId: string,
    input: ChannelThreadCreateInput
  ): Promise<ChannelThreadCreated> {
    return channel.createChannelThread(this.transport, channelId, input);
  }

  // ⚠ `closeChannelThread` (human lane) and `proposeChannelThreadClose` (agent
  // lane) were methods here until thread closing was removed (wiring plan
  // Phase 4, 2026-08-18). `client-surface.test.ts` records the arithmetic.

  setChannelThreadMode(
    channelId: string,
    threadId: string,
    input: { mode: ThreadMode }
  ): Promise<ChannelThread> {
    return channel.setChannelThreadMode(this.transport, channelId, threadId, input);
  }
}
