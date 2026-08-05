import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelAgentRow } from "./agents-dto";

/**
 * Pure data access for `channel_agents` — ONE READ, and no writes at all.
 *
 * Every write this module had (`insertAgent`, `updateAgentName`,
 * `updateAgentStatus`, `markAgentsEngaged`, `clearAgentEngagement`,
 * `clearEngagementByEngager`) served summoning, renaming, parking or
 * engagement, and all four are gone (rollback §1). The rows they wrote are
 * LEFT IN PLACE: a stored message's `metadata.author_agent_id` still has to
 * resolve to a handle, which is what {@link listAgentsByChannel} is for.
 *
 * The service-role admin client (RLS-bypassing) stays — visibility lives in the
 * service layer, and the read is gated by the CHANNEL's own visibility rule.
 */

/**
 * Explicit row cap. PostgREST truncates an un-limited select SILENTLY at its
 * own `max-rows` setting, so a read states its bound here instead of inheriting
 * an invisible one. Far above any real room; a clipped list would only cost an
 * old message its handle, never correctness.
 */
const AGENT_ROWS_LIMIT = 500;

/**
 * Every agent that ever existed in a channel, oldest first — DISMISSED ROWS
 * INCLUDED, which is the whole point: the agents whose messages most need
 * attribution are precisely the retired ones.
 */
export async function listAgentsByChannel(
  channelId: string
): Promise<ChannelAgentRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_agents")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true })
    .limit(AGENT_ROWS_LIMIT);
  if (error) throw error;
  return (data ?? []) as ChannelAgentRow[];
}
