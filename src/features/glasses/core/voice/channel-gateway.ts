import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { postMessage } from "@/features/channels/server/service";
import { agentNamesFor } from "@/features/channels/server/service-shared";
import { listChannelSessionStates } from "@/features/channels/server/repository-sessions";
import { agentIdHandle } from "@/features/channels/lib/agent-mentions";
import { authorAgentIdOf } from "@/features/channels/lib/agent-post-stamp";
import { operatorChannelContext } from "../channel-context";
import { isUuid } from "../validation";
import { UtteranceError, type ChannelGateway, type ChannelReply, type PostedUtterance } from "./utterance";

/**
 * The real {@link ChannelGateway}: posts through the channels service's own
 * `postMessage`, the same write every Dopl door uses, so the server's wake
 * verdict is computed and stored exactly as for a message typed in the app,
 * and the operator's desktop wakes its agent off that row. Reads go straight to
 * `channel_messages` with the service role.
 */

export const glassesChannelGateway: ChannelGateway = {
  async postAsOperator(channel, operatorUserId, text, agentId): Promise<PostedUtterance> {
    const { channelId, containerId, name: channelName } = channel;
    const live = (await listChannelSessionStates(containerId, channelId)).filter((s) => s.name.length > 0);
    // An AGENT target is @-addressed and must be running; a CHANNEL target is
    // unaddressed, so the server's normal rule (a person's unaddressed post is
    // answered by the room's nominee) decides who wakes.
    const session = agentId ? live.find((s) => s.name === agentId) : undefined;
    if (agentId && !session) {
      throw new UtteranceError("That agent is not running. Start it again from the glasses menu.");
    }
    const addressedTo = agentId ? agentIdHandle(agentId) : null;
    const ctx = await operatorChannelContext(operatorUserId, containerId);
    const posted = await postMessage(ctx, channelId, {
      body: text,
      clientMsgId: `glasses-${randomUUID()}`,
      ...(addressedTo ? { to: `@${addressedTo}` } : {}),
    });
    return {
      id: posted.id,
      seq: posted.seq,
      recipientAgentIds: posted.recipientAgentIds ?? [],
      liveAgents: live.length,
      addressedTo,
      addressedName: session?.display_name?.trim() || null,
      channelName,
    };
  },

  async agentMessagesAfter(channelId, seq, limit): Promise<ChannelReply[]> {
    return (await glassesChannelGateway.agentMessagesAfterMany(new Map([[channelId, seq]]), limit)).get(channelId) ?? [];
  },

  async agentMessagesAfterMany(cursors, limitPerChannel) {
    const out = new Map<string, ChannelReply[]>();
    const valid = [...cursors].filter(([id, seq]) => isUuid(id) && Number.isSafeInteger(seq));
    if (valid.length === 0) return out;
    // One read for every channel: `(channel_id = A AND seq > a) OR (channel_id = B AND seq > b) …`.
    // Ordered (channel, seq) so a clip never skips a row below a kept one; the
    // overall limit is per-channel × channels, and a clipped channel resumes next pass.
    const { data, error } = await supabaseAdmin()
      .from("channel_messages")
      .select("id, seq, channel_id, body, workspace_id, author_kind, client_msg_id, metadata")
      .or(valid.map(([id, seq]) => `and(channel_id.eq.${id},seq.gt.${seq})`).join(","))
      .eq("author_kind", "agent")
      .eq("kind", "message")
      .order("channel_id", { ascending: true })
      .order("seq", { ascending: true })
      .limit(limitPerChannel * valid.length);
    if (error) throw new Error(`glasses reply read failed: ${error.message}`);
    const rows = (data ?? []) as {
      id: string;
      seq: number;
      channel_id: string;
      body: string;
      workspace_id: string;
      author_kind: string;
      client_msg_id: string | null;
      metadata: Record<string, unknown> | null;
    }[];
    if (rows.length === 0) return out;
    const names = await agentNamesFor([...new Set(rows.map((r) => r.workspace_id))], rows);
    for (const r of rows) {
      const list = out.get(r.channel_id) ?? [];
      if (list.length >= limitPerChannel) continue;
      const agentId = authorAgentIdOf({ clientMsgId: r.client_msg_id, metadata: r.metadata });
      list.push({
        id: r.id,
        seq: Number(r.seq),
        body: r.body,
        agentName: (agentId && names.get(agentId)) || (agentId ? agentIdHandle(agentId) : "Agent"),
        agentId,
      });
      out.set(r.channel_id, list);
    }
    return out;
  },

  async headSeq(channelId) {
    const { data, error } = await supabaseAdmin()
      .from("channel_messages")
      .select("seq")
      .eq("channel_id", channelId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`glasses head read failed: ${error.message}`);
    return Number((data as { seq: number } | null)?.seq ?? 0);
  },
};
