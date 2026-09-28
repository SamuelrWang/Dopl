import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { awaitNewMessages, readTranscript, resolveReadableChannelId } from "@/features/channels/server/service";
import { listAccountChannels } from "@/features/channels/server/service-list";
import { createLaunchDirective, getLaunchDirective } from "@/features/channels/server/service-launch";
import { authorAgentIdOf } from "@/features/channels/lib/agent-post-stamp";
import type { ChannelMessage } from "@/features/channels/types";
import type { LaunchDirective } from "@/features/channels/types-launch";
import { operatorChannelContext } from "../channel-context";
import type { LaunchState, MenuChannelHandle, MenuGateway, MenuMessage, MenuSession } from "./types";

/**
 * The real {@link MenuGateway}: Dopl's own services for every read and the
 * launch, so the menu sees exactly what the app would (membership, public /
 * guest rules, soft deletes and the launch gates all come from the channels
 * service). Two narrow reads go to tables directly (session rows across the
 * user's channels, launch history), always filtered by channel ids the caller
 * already proved membership of, or by the caller's own `operator_user_id`.
 */

function toMenuMessage(m: ChannelMessage): MenuMessage {
  return {
    seq: m.seq,
    kind: m.kind,
    authorKind: m.authorKind,
    authorUserId: m.authorUserId,
    authorName: m.authorName,
    authorAgentId: m.authorKind === "agent" ? authorAgentIdOf({ clientMsgId: m.clientMsgId, metadata: m.metadata }) : null,
    authorAgentName: m.authorAgentName ?? null,
    recipientAgentIds: m.recipientAgentIds ?? [],
    body: m.body,
    createdAt: m.createdAt,
  };
}

function toLaunchState(d: LaunchDirective): LaunchState {
  const status = d.status === "launched" || d.status === "done" ? "launched" : d.status === "refused" || d.status === "expired" ? d.status : "launching";
  return {
    directiveId: d.id,
    status,
    agentId: d.agentId,
    agentName: d.appliedAgentName ?? d.agentName,
    refusalReason: d.refusalReason,
  };
}

export const menuGateway: MenuGateway = {
  async listChannels(userId) {
    const { channels } = await listAccountChannels(userId, null);
    const live = channels.filter((c) => c.isMember && !c.archivedAt);
    const containerIds = [...new Set(live.map((c) => c.workspaceId))];
    const { data, error } = containerIds.length
      ? await supabaseAdmin().from("workspaces").select("id, name, kind").in("id", containerIds)
      : { data: [], error: null };
    if (error) throw new Error(`glasses container read failed: ${error.message}`);
    const names = new Map(
      ((data ?? []) as { id: string; name: string; kind: string }[]).map((w) => [w.id, w.kind === "home" ? "Home" : w.name]),
    );
    return live.map((c) => ({
      id: c.id,
      name: c.isDirect && c.directPeer?.displayName ? c.directPeer.displayName : c.name,
      containerId: c.workspaceId,
      containerName: names.get(c.workspaceId) ?? "",
      lastActivity: c.lastMessageAt,
      unread: c.unread,
    }));
  },

  async listSessions(channelIds, limit) {
    if (channelIds.length === 0) return [];
    // Peer projection only — the columns every member of these channels may see.
    const { data, error } = await supabaseAdmin()
      .from("channel_sessions")
      .select("name, display_name, channel_id, state, detail, model, last_activity_at, updated_at, user_id, tool_label")
      .in("channel_id", channelIds)
      .neq("name", "")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`glasses sessions read failed: ${error.message}`);
    return ((data ?? []) as Record<string, string | null>[]).map(
      (r): MenuSession => ({
        agentId: r.name as string,
        displayName: r.display_name,
        channelId: r.channel_id as string,
        state: (r.state as string) ?? "idle",
        detail: r.detail,
        model: r.model,
        lastActivity: r.last_activity_at ?? r.updated_at,
        updatedAt: r.updated_at,
        userId: r.user_id,
        toolLabel: r.tool_label,
      }),
    );
  },

  async runtimesFor(agentIds) {
    if (agentIds.length === 0) return new Map();
    const { data, error } = await supabaseAdmin()
      .from("channel_launch_directives")
      .select("agent_id, applied_runtime, runtime")
      .in("agent_id", agentIds);
    if (error) throw new Error(`glasses runtime read failed: ${error.message}`);
    return new Map(
      ((data ?? []) as { agent_id: string; applied_runtime: string | null; runtime: string | null }[])
        .filter((r) => r.applied_runtime || r.runtime)
        .map((r) => [r.agent_id, (r.applied_runtime ?? r.runtime) as string]),
    );
  },

  async recentLaunchNames(userId) {
    const { data, error } = await supabaseAdmin()
      .from("channel_launch_directives")
      .select("agent_name, applied_agent_name")
      .eq("operator_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`glasses launch names read failed: ${error.message}`);
    return ((data ?? []) as { agent_name: string | null; applied_agent_name: string | null }[])
      .flatMap((r) => [r.agent_name, r.applied_agent_name])
      .filter((n): n is string => !!n);
  },

  async launchHistory(userId) {
    const { data, error } = await supabaseAdmin()
      .from("channel_launch_directives")
      .select("applied_runtime, applied_model, created_at")
      .eq("operator_user_id", userId)
      .eq("status", "launched")
      .not("applied_runtime", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`glasses launch history read failed: ${error.message}`);
    return ((data ?? []) as { applied_runtime: string; applied_model: string | null }[]).map((r) => ({
      runtime: r.applied_runtime,
      model: r.applied_model,
    }));
  },

  async openChannel(userId, link): Promise<MenuChannelHandle> {
    const ctx = await operatorChannelContext(userId, link.containerId);
    const channelId = link.channelId;
    let readableId: Promise<string> | null = null;
    return {
      async readMessages(q) {
        const { messages, hasMore } = await readTranscript(ctx, channelId, { before: q.before, limit: q.limit });
        return { messages: messages.map(toMenuMessage), hasMore };
      },
      async awaitMessages(after, deadline, signal) {
        readableId ??= resolveReadableChannelId(ctx, channelId);
        const { messages } = await awaitNewMessages(ctx, await readableId, { since: after, deadline, signal, pollIntervalMs: 2000 });
        return messages.map(toMenuMessage);
      },
      async createLaunch(input) {
        const result = await createLaunchDirective(ctx, {
          channel: channelId,
          agentName: input.agentName,
          runtime: input.runtime,
          ...(input.model ? { model: input.model } : {}),
          clientMsgId: input.clientMsgId,
        });
        return result.offline ? null : toLaunchState(result.directive);
      },
      async getLaunch(directiveId) {
        return toLaunchState(await getLaunchDirective(ctx, directiveId));
      },
    };
  },
};
