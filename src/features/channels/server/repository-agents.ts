import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { pgErrorCode } from "./repository";
import type { ChannelAgentRow } from "./agents-dto";

/**
 * Pure data access for `channel_agents`. Split out of `repository.ts` so that
 * file stays under the 500-line cap (§2). Every function uses the service-role
 * admin client (RLS-bypassing) — visibility + authz live in the service layer.
 * Writes are service-role only (base DML REVOKEd from authenticated/anon).
 */

/** Postgres SQLSTATE 23505 — the case-folded per-channel handle collided. */
const UNIQUE_VIOLATION = "23505";

/**
 * Explicit row cap. PostgREST truncates an un-limited select SILENTLY at its
 * own `max-rows` setting, so a read whose result feeds a name-collision set
 * states its bound here instead of inheriting an invisible one. Far above any
 * realistic room — a clipped roster would hand `pickAgentName` a taken handle.
 */
const AGENT_ROWS_LIMIT = 500;

type AgentInsert = {
  channel_id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  status?: string;
};

/**
 * Summon an agent. Throws the raw Postgres error on a handle collision — the
 * service maps it via `pgErrorCode(err) === "23505"`, the same shape every
 * other channels write uses. (`updateAgentName` is the deliberate exception;
 * see its note.)
 */
export async function insertAgent(row: AgentInsert): Promise<ChannelAgentRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_agents")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelAgentRow;
}

export async function findAgentById(
  agentId: string
): Promise<ChannelAgentRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_agents")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelAgentRow | null) ?? null;
}

/**
 * One agent by handle within a channel, CASE-FOLDED — `@Quartz` and `@quartz`
 * resolve to the same row, matching the `(channel_id, lower(name))` unique
 * index.
 *
 * The fold is done by lowercasing the NEEDLE and comparing with `eq`, not with
 * `ilike`: an `ilike` would treat `%` and `_` in a caller-supplied mention as
 * wildcards, so a handle like `a_ent` could resolve to a different agent. Exact
 * equality is sound because the column's CHECK (`^[a-z][a-z0-9-]{1,30}$`) means
 * every STORED handle is already lowercase.
 */
export async function findAgentByName(
  channelId: string,
  name: string
): Promise<ChannelAgentRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_agents")
    .select("*")
    .eq("channel_id", channelId)
    .eq("name", name.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelAgentRow | null) ?? null;
}

/** Every agent in a channel, oldest first (summon order reads as a roster). */
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

/**
 * Flip an agent's lifecycle status. `updated_at` is bumped. The patch never
 * touches `workspace_id` / `channel_id`, so the workspace-consistency guard
 * (which fires only on UPDATE OF those columns) is never re-triggered.
 *
 * `clearEngagement` folds the disengage into the SAME statement rather than
 * chasing it with a second write: parking an agent while it is still recorded
 * as engaged would leave a row that reads "listening for Sam" about a process
 * that is not running, and a two-statement version can stop halfway there.
 * WHICH statuses clear is the service's call, not this one's.
 */
export async function updateAgentStatus(
  agentId: string,
  status: string,
  opts: { clearEngagement?: boolean } = {}
): Promise<ChannelAgentRow> {
  const db = supabaseAdmin();
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (opts.clearEngagement) {
    patch.engaged_at = null;
    patch.engaged_by = null;
  }
  const { data, error } = await db
    .from("channel_agents")
    .update(patch)
    .eq("id", agentId)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelAgentRow;
}

/**
 * ENGAGE every named agent for `engagedBy` — one statement for the whole
 * addressed set, because "@quartz @onyx work together" is ONE decision by ONE
 * human and a partial application of it is a room where half the agents are
 * listening.
 *
 * `engaged_at` is stamped from the SERVER's clock, never a caller's. It is a
 * FACT (when a human last addressed this agent), not a state: nothing here or
 * anywhere else on the server expires it — the desktop applies
 * `ENGAGEMENT_TTL_MS` against the timestamp and refreshes it by acting.
 */
export async function markAgentsEngaged(
  agentIds: string[],
  engagedBy: string
): Promise<void> {
  if (agentIds.length === 0) return;
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await db
    .from("channel_agents")
    .update({ engaged_at: now, engaged_by: engagedBy, updated_at: now })
    .in("id", agentIds);
  if (error) throw error;
}

/**
 * Clear one agent's engagement. Idempotent by construction — clearing an
 * already-idle agent writes the same two nulls and returns the same row, so a
 * double-tapped "Disengage" is not an error.
 */
export async function clearAgentEngagement(
  agentId: string
): Promise<ChannelAgentRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_agents")
    .update({
      engaged_at: null,
      engaged_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agentId)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelAgentRow;
}

/**
 * Clear engagement for every agent in a channel that `engagedBy` engaged.
 *
 * The DEPARTURE sweep. An agent outlives the engager's membership
 * (`channel_agents` has no FK to `channel_members`), so a member who tagged
 * `@quartz` and then left the room left it engaged — acting on the untagged
 * messages of everyone still there for the rest of the TTL — and could not undo
 * it: `disengageAgent` starts at `loadVisibleChannel`, which reads a private
 * channel as not-found to a non-member. The exit is the only moment at which
 * anyone can still clean this up, so it is cleaned up there
 * (`service-writes-members.ts` `removeMember`).
 *
 * Scoped to ONE channel, matching the row that was removed: engagement in a
 * room the member is still in is untouched. Set-based rather than row-by-row
 * for the same reason `markAgentsEngaged` is — one departure is one decision,
 * and half a room still listening for someone who left is not a state anybody
 * asked for. A no-op when they engaged nothing.
 */
export async function clearEngagementByEngager(
  channelId: string,
  engagedBy: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channel_agents")
    .update({
      engaged_at: null,
      engaged_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", channelId)
    .eq("engaged_by", engagedBy);
  if (error) throw error;
}

/**
 * Rename an agent. Returns NULL — not a throw — when the new handle is already
 * taken in that channel, so the service can map it to a clean 409 without
 * re-inspecting a raw Postgres error. Every OTHER failure still throws.
 *
 * The caller is expected to pass an already-normalized (lowercase) handle; the
 * column CHECK rejects anything outside `^[a-z][a-z0-9-]{1,30}$` regardless.
 */
export async function updateAgentName(
  agentId: string,
  name: string
): Promise<ChannelAgentRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_agents")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", agentId)
    .select("*")
    .single();
  if (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) return null;
    throw error;
  }
  return data as ChannelAgentRow;
}
