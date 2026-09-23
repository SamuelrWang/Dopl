import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Data access for `channel_launch_directives`. Every function uses the admin client (the table
 * has no write policy), so the `operatorUserId` argument is the whole fence and must never come
 * from a payload. The claim is a CAS: one machine wins, losers get `null`.
 */

export type {
  LaunchDirectiveRow,
  LaunchDirectiveInsert,
  LaunchDecision,
} from "./repository-launch-types";
import type {
  LaunchDirectiveRow,
  LaunchDirectiveInsert,
  LaunchDecision,
} from "./repository-launch-types";

/** Exported so `repository-session-colors.ts › pendingDirectiveColors` names it by reference. */
export const LAUNCH_DIRECTIVES_TABLE = "channel_launch_directives";
const TABLE = LAUNCH_DIRECTIVES_TABLE;

export async function insertLaunchDirective(
  operatorUserId: string,
  input: LaunchDirectiveInsert
): Promise<LaunchDirectiveRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    // The stamp goes last so no key in `input` can shadow it.
    .insert({ ...input, operator_user_id: operatorUserId })
    .select("*")
    .single();
  if (error) throw error;
  return data as LaunchDirectiveRow;
}

/** Another operator's directive is invisible (`null`), not forbidden, so existence never leaks. */
export async function findLaunchDirective(
  operatorUserId: string,
  workspaceId: string,
  id: string
): Promise<LaunchDirectiveRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("operator_user_id", operatorUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as LaunchDirectiveRow | null) ?? null;
}

/**
 * The idempotency probe: the predicates are the unique index, and there is no `status` filter so
 * a retry converges on the stored row whatever became of it. The one statement here without a
 * `workspace_id` filter: `channel_id` implies the workspace (INVARIANTS §2).
 */
export async function findLaunchDirectiveByClientMsgId(
  operatorUserId: string,
  channelId: string,
  clientMsgId: string
): Promise<LaunchDirectiveRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("channel_id", channelId)
    .eq("operator_user_id", operatorUserId)
    .eq("client_msg_id", clientMsgId)
    .maybeSingle();
  if (error) throw error;
  return (data as LaunchDirectiveRow | null) ?? null;
}

/**
 * The claim CAS, `pending → claimed`. `null` (lost the race, already decided, or not this
 * operator's) is not an error: the caller stands down. An expired-but-pending row is still
 * claimable here; expiry is lazy and the service judges freshness.
 */
export async function claimLaunchDirective(
  operatorUserId: string,
  workspaceId: string,
  id: string,
  claimedAt: string
): Promise<LaunchDirectiveRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .update({ status: "claimed", claimed_at: claimedAt })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("operator_user_id", operatorUserId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as LaunchDirectiveRow | null) ?? null;
}

/**
 * Also a CAS: only an undecided row this operator owns moves, so a retried decide returns `null`
 * rather than flipping the outcome. `pending` is accepted so a machine that crashed between claim
 * and decide can still report.
 */
export async function decideLaunchDirective(
  operatorUserId: string,
  workspaceId: string,
  id: string,
  decision: LaunchDecision
): Promise<LaunchDirectiveRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .update(decision)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("operator_user_id", operatorUserId)
    .in("status", ["pending", "claimed"])
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as LaunchDirectiveRow | null) ?? null;
}

/**
 * The backstop read for a desktop that missed the realtime INSERT (F-273). Includes `claimed` so a
 * machine that crashed after claiming finds its row again; expiry is applied by the service.
 */
const PENDING_DIRECTIVE_LIMIT = 100;

export async function listPendingLaunchDirectives(
  operatorUserId: string,
  workspaceId: string
): Promise<LaunchDirectiveRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("operator_user_id", operatorUserId)
    .in("status", ["pending", "claimed"])
    .order("created_at", { ascending: true })
    .limit(PENDING_DIRECTIVE_LIMIT);
  if (error) throw error;
  return (data ?? []) as LaunchDirectiveRow[];
}
