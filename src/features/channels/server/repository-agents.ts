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
 */
export async function updateAgentStatus(
  agentId: string,
  status: string
): Promise<ChannelAgentRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_agents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", agentId)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelAgentRow;
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
