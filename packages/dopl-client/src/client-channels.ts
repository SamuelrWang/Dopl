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
  ChannelSessionState,
  ChannelThread,
  ChannelThreadCloseProposed,
  ChannelThreadClosed,
  ChannelThreadCreated,
  ChannelThreadCreateInput,
  ChannelThreadPage,
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

  /** One page of a channel's threads, most recently active first, plus whether
   *  the server's ceiling clipped it. ⚠ Never re-sort the page — see
   *  `channel.ts › listChannelThreads`. */
  listChannelThreads(channelId: string): Promise<ChannelThreadPage> {
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
   * The agent lane's terminal act on a thread — see
   * `channel.proposeChannelThreadClose`. `closeChannelThread` above is the
   * human lane; the server refuses it for an agent token.
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
