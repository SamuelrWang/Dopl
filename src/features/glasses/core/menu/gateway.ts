import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { awaitNewMessages, readTranscript, resolveReadableChannelId } from "@/features/channels/server/service";
import { listAccountChannels } from "@/features/channels/server/service-list";
import { createLaunchDirective, getLaunchDirective } from "@/features/channels/server/service-launch";
import { authorAgentIdOf } from "@/features/channels/lib/agent-post-stamp";
import type { ChannelMessage } from "@/features/channels/types";
import type { LaunchDirective } from "@/features/channels/types-launch";
import { operatorChannelContext } from "../channel-context";
import { answerDisplay } from "@/features/display/server/answer";
import { displayOf } from "@/features/display/core/adapt";
import { ESCALATION_ANSWER_METADATA_KEY, parseEscalationAnswer } from "@/features/channels/escalation";
import { AGENT_ID_RE } from "../voice/target";
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
    id: m.id,
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
    display: displayOf(m.metadata),
    answerTo: answerToOf(m),
  };
}

/** C3 `answer_to`: the decision an answer message answers (its body is the pressed label). */
function answerToOf(m: ChannelMessage): MenuMessage["answerTo"] {
  const a = parseEscalationAnswer(m.metadata?.[ESCALATION_ANSWER_METADATA_KEY]);
  return a ? { message_id: a.escalationMessageId, index: a.optionIndex, choice: m.body.trim().slice(0, 200) } : null;
}

/** Newest first → first name per agent id wins. */
function firstNames<T>(rows: T[], idOf: (r: T) => string | null, nameOf: (r: T) => string | null, into: Map<string, string>) {
  for (const r of rows) {
    const id = idOf(r);
    const name = nameOf(r)?.trim();
    if (id && name && !into.has(id)) into.set(id, name);
  }
}

/** A best-effort name source: a failed read (or a missing table) only loses names, never the page. */
async function quietRows<T>(label: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    console.error(`[glasses] ${label} read failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as T[];
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

  async persistedAgentNames(channelIds, agentIds) {
    const ids = [...new Set(agentIds)].filter((id) => AGENT_ID_RE.test(id));
    const out = new Map<string, string>();
    if (channelIds.length === 0 || ids.length === 0) return out;
    const db = supabaseAdmin();
    // Two durable records, both written by the operator's own desktop, read in one round:
    //  1. the token ledger's per-run label (`session_key` = `<channel>:<thread>:<agent>`), which
    //     follows renames up to the run's last push;
    //  2. the launch directive's name (applied, else asked for, else the identity's).
    const [spend, launches] = await Promise.all([
      quietRows<{ session_key: string; agent_name: string | null }>(
        "agent names (spend)",
        db
          .from("workspace_token_spend")
          .select("session_key, agent_name")
          .in("channel_id", channelIds)
          .or(ids.map((id) => `session_key.like.*:${id}`).join(","))
          .not("agent_name", "is", null)
          .order("updated_at", { ascending: false })
          .limit(500),
      ),
      quietRows<{ agent_id: string | null; applied_agent_name: string | null; agent_name: string | null; identity_name: string | null }>(
        "agent names (launches)",
        db
          .from("channel_launch_directives")
          .select("agent_id, applied_agent_name, agent_name, identity_name")
          .in("channel_id", channelIds)
          .in("agent_id", ids)
          .order("created_at", { ascending: false })
          .limit(500),
      ),
    ]);
    firstNames(spend, (r) => r.session_key.slice(r.session_key.lastIndexOf(":") + 1), (r) => r.agent_name, out);
    firstNames(launches, (r) => r.agent_id, (r) => r.applied_agent_name ?? r.agent_name ?? r.identity_name, out);
    return out;
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
      async answerDisplay(messageId, input, source) {
        // The app's own answer path, as the owner, stamped as coming from the glasses.
        const { answer } = await answerDisplay({ ...ctx, messageSource: source }, channelId, messageId, input);
        return { answer };
      },
    };
  },
};
