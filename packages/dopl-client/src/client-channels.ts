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
  ChannelSessionState,
  ChannelThread,
  ChannelThreadCloseProposed,
  ChannelThreadClosed,
  ChannelThreadCreated,
  ChannelThreadCreateInput,
  ReadMessagesOptions,
  ThreadMode,
  ThreadOutcome,
} from "./channel-types.js";

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

  listChannelThreads(channelId: string): Promise<ChannelThread[]> {
    return channel.listChannelThreads(this.transport, channelId);
  }

  listChannelSessions(channelId?: string): Promise<ChannelSessionState[]> {
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

  closeChannelThread(
    channelId: string,
    threadId: string,
    input: { outcome: ThreadOutcome; summary?: string }
  ): Promise<ChannelThreadClosed> {
    return channel.closeChannelThread(this.transport, channelId, threadId, input);
  }

  /**
   * DECISION 2 (2026-08-04) — the agent lane's terminal act on a thread. See
   * `channel.proposeChannelThreadClose`; `closeChannelThread` above is the human
   * lane and the server refuses it for an agent token.
   */
  proposeChannelThreadClose(
    channelId: string,
    threadId: string,
    input: { outcome: ThreadOutcome; summary?: string }
  ): Promise<ChannelThreadCloseProposed> {
    return channel.proposeChannelThreadClose(
      this.transport,
      channelId,
      threadId,
      input
    );
  }

  setChannelThreadMode(
    channelId: string,
    threadId: string,
    input: { mode: ThreadMode }
  ): Promise<ChannelThread> {
    return channel.setChannelThreadMode(this.transport, channelId, threadId, input);
  }
}
