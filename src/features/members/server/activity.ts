import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { TeamResourceType } from "@/features/teams/access-levels";
import type { ActivityEventRow, ActivityVerb } from "../activity-visibility";

/**
 * Writes and reads for `workspace_activity_events`.
 *
 * ⚠ SERVICE-ROLE BOTH WAYS. The table has SELECT revoked from `authenticated`
 * because its read filter is effective-access, which RLS cannot express
 * (see the migration). This module and the activity route are the only readers.
 */

const COLUMNS = "id, actor_user_id, verb, resource_type, resource_id, metadata, created_at";

/** Newest-first cap. The console shows a recent-activity list, not a log. */
const DEFAULT_LIMIT = 40;

interface RecordInput {
  workspaceId: string;
  actorUserId: string;
  verb: ActivityVerb;
  resourceType?: TeamResourceType | "team" | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * ⚠ NEVER THROWS. Activity is an observation of a write that already
 * succeeded; failing to record it must not fail the member's role change or
 * undo a team edit. A dropped row is a gap in a feed, which is recoverable —
 * a thrown error here is a 500 on a write that worked, which is not.
 */
export async function recordActivity(input: RecordInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("workspace_activity_events").insert({
      workspace_id: input.workspaceId,
      actor_user_id: input.actorUserId,
      verb: input.verb,
      resource_type: input.resourceType ?? null,
      resource_id: input.resourceId ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) throw error;
  } catch (err) {
    console.error("[members/activity] record failed:", input.verb, err);
  }
}

export async function listMemberActivity(
  workspaceId: string,
  actorUserId: string,
  limit = DEFAULT_LIMIT
): Promise<ActivityEventRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_activity_events")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("actor_user_id", actorUserId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    actorUserId: row.actor_user_id as string,
    verb: row.verb as ActivityVerb,
    resourceType: row.resource_type as ActivityEventRow["resourceType"],
    resourceId: row.resource_id as string | null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at as string,
  }));
}

/** Team ids the caller belongs to — team events are scoped to team membership,
 *  the access matrix having no row for a team itself. */
export async function callerTeamIds(
  workspaceId: string,
  userId: string
): Promise<ReadonlySet<string>> {
  const { data, error } = await supabaseAdmin()
    .from("team_members")
    .select("team_id, teams!inner(workspace_id)")
    .eq("user_id", userId)
    .eq("teams.workspace_id", workspaceId);
  if (error) throw error;
  return new Set((data ?? []).map((row: Record<string, unknown>) => row.team_id as string));
}
