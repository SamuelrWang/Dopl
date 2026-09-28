import type { ChannelGateway, ChannelReply, PostedUtterance } from "../voice/utterance";

/** In-memory {@link ChannelGateway} for tests: a channel as a seq-ordered list. */
export function createFakeChannel(opts: { liveAgents?: number } = {}) {
  const messages: (ChannelReply & { author: "user" | "agent"; agentId?: string | null })[] = [];
  let seq = 100;
  const gateway: ChannelGateway = {
    async postAsOperator(channel, _operatorUserId, text, agentId): Promise<PostedUtterance> {
      seq += 1;
      const id = `msg-${seq}`;
      messages.push({ id, seq, body: text, agentName: "", author: "user", agentId });
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
    async agentMessagesAfter(_channelId, after, limit) {
      return messages.filter((m) => m.author === "agent" && m.seq > after).slice(0, limit);
    },
    async headSeq() {
      return seq;
    },
  };
  return {
    gateway,
    messages,
    agentSays(body: string, agentName = "Coder") {
      seq += 1;
      messages.push({ id: `msg-${seq}`, seq, body, agentName, author: "agent", agentId: "abcdefgh" });
      return `msg-${seq}`;
    },
  };
}
