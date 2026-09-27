import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import { buildChannelContext, postMessage } from "@/features/channels/server/service";
import { agentNamesFor } from "@/features/channels/server/service-shared";
import { listChannelSessionStates } from "@/features/channels/server/repository-sessions";
import { agentIdHandle } from "@/features/channels/lib/agent-mentions";
import { authorAgentIdOf } from "@/features/channels/lib/agent-post-stamp";
import { UtteranceError, type ChannelGateway, type ChannelReply, type PostedUtterance } from "./voice-utterance";

/**
 * The real {@link ChannelGateway}: posts through the channels service's own
 * `postMessage` — the same write every Dopl door uses (REST route and MCP send
 * both land there) — so the server's wake verdict is computed and stored exactly
 * as for a message typed in the app, and the operator's desktop wakes its agent
 * off that row. Reads go straight to `channel_messages` with the service role.
 */

async function channelRow(channelId: string): Promise<{ workspace_id: string; name: string }> {
  const { data, error } = await supabaseAdmin()
    .from("channels")
    .select("workspace_id, name")
    .eq("id", channelId)
    .maybeSingle();
  if (error || !data) throw new Error(`channel ${channelId} not found`);
  return data as { workspace_id: string; name: string };
}

async function postOnce(
  operatorUserId: string,
  workspaceId: string,
  channelId: string,
  text: string,
  to: string | undefined,
) {
  const { workspace, membership } = await resolveActiveWorkspace(operatorUserId, workspaceId);
  const ctx = buildChannelContext({
    userId: operatorUserId,
    workspaceId: workspace.id,
    role: membership.role,
    workspaceKind: workspace.kind,
    agentTokenId: null,
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: operatorUserId,
  });
  return postMessage(ctx, channelId, { body: text, clientMsgId: `glasses-${randomUUID()}`, ...(to ? { to } : {}) });
}

export const glassesChannelGateway: ChannelGateway = {
  async postAsOperator(channelId, operatorUserId, text, agentId): Promise<PostedUtterance> {
    const { workspace_id: workspaceId, name: channelName } = await channelRow(channelId);
    const live = (await listChannelSessionStates(workspaceId, channelId)).filter((s) => s.name.length > 0);
    // An AGENT target is @-addressed and must be running; a CHANNEL target is
    // unaddressed, so the server's normal rule (RR3: a person's unaddressed post
    // is answered by the room's nominee) decides who wakes.
    const session = agentId ? live.find((s) => s.name === agentId) : undefined;
    if (agentId && !session) {
      throw new UtteranceError("That agent is not running. Start it again from the glasses menu.");
    }
    const addressedTo = agentId ? agentIdHandle(agentId) : null;
    const posted = await postOnce(operatorUserId, workspaceId, channelId, text, addressedTo ? `@${addressedTo}` : undefined);
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
    const { data, error } = await supabaseAdmin()
      .from("channel_messages")
      .select("id, seq, body, workspace_id, author_kind, client_msg_id, metadata")
      .eq("channel_id", channelId)
      .eq("author_kind", "agent")
      .eq("kind", "message")
      .gt("seq", seq)
      .order("seq", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`glasses reply read failed: ${error.message}`);
    const rows = (data ?? []) as {
      id: string;
      seq: number;
      body: string;
      workspace_id: string;
      author_kind: string;
      client_msg_id: string | null;
      metadata: Record<string, unknown> | null;
    }[];
    if (rows.length === 0) return [];
    const names = await agentNamesFor([...new Set(rows.map((r) => r.workspace_id))], rows);
    return rows.map((r) => {
      const agentId = authorAgentIdOf({ clientMsgId: r.client_msg_id, metadata: r.metadata });
      return {
        id: r.id,
        seq: Number(r.seq),
        body: r.body,
        agentName: (agentId && names.get(agentId)) || (agentId ? agentIdHandle(agentId) : "Agent"),
        agentId,
      };
    });
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
