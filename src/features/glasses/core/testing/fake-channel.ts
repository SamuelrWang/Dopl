import type { MessageSourceStamp } from "@/features/channels/server/message-source-stamp";
import type { ChannelGateway, ChannelReply, PostedUtterance } from "../voice/utterance";

/** A message in no particular channel matches every channel (single-channel tests). */
const ANY = "*";
const inChannel = (m: { channelId: string }, channelId: string) => m.channelId === ANY || m.channelId === channelId;

/**
 * In-memory {@link ChannelGateway} for tests: channels as one seq-ordered list
 * (seq is shared across channels here; only order within a channel matters).
 * `agentSays(body, name, channelId?)` defaults to the single-channel `"chan"`.
 */
export function createFakeChannel(opts: { liveAgents?: number } = {}) {
  const messages: (ChannelReply & { author: "user" | "agent"; agentId?: string | null; channelId: string; source?: MessageSourceStamp })[] = [];
  let seq = 100;
  const gateway: ChannelGateway = {
    async postAsOperator(channel, _operatorUserId, text, agentId, source): Promise<PostedUtterance> {
      seq += 1;
      const id = `msg-${seq}`;
      messages.push({ id, seq, body: text, agentName: "", author: "user", agentId, channelId: channel.channelId, source });
      const live = opts.liveAgents ?? 1;
      return {
        id,
        seq,
        recipientAgentIds: live > 0 ? ["abcdefgh"] : [],
        liveAgents: live,
        addressedTo: agentId ? `agent-${agentId}` : null,
        addressedName: agentId ? "Orchestrator" : null,
        channelName: channel.name,
      };
    },
    async agentMessagesAfter(channelId, after, limit) {
      return messages.filter((m) => m.author === "agent" && m.seq > after && inChannel(m, channelId)).slice(0, limit);
    },
    async agentMessagesAfterMany(cursors, limit) {
      const out = new Map<string, ChannelReply[]>();
      for (const [channelId, after] of cursors) {
        const list = await gateway.agentMessagesAfter(channelId, after, limit);
        if (list.length) out.set(channelId, list);
      }
      reads.push([...cursors.keys()]);
      return out;
    },
    async headSeq() {
      // seq is shared across channels, so the global counter is at or past every channel's head.
      return seq;
    },
  };
  /** The channel-id batches `agentMessagesAfterMany` was called with (one entry per read). */
  const reads: string[][] = [];
  return {
    gateway,
    messages,
    reads,
    agentSays(body: string, agentName = "Coder", channelId = ANY) {
      seq += 1;
      messages.push({ id: `msg-${seq}`, seq, body, agentName, author: "agent", agentId: "abcdefgh", channelId });
      return `msg-${seq}`;
    },
  };
}
