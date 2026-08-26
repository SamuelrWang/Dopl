import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ProfileRef } from "./dto";

/**
 * The two reads the channels repository makes that are NOT about channels: is
 * this person an active member of the workspace, and what are these people
 * called.
 *
 * ⚠ **ITS OWN MODULE BECAUSE `repository.ts` REACHED THE 500-LINE CAP**
 * (2026-08-26; it was 499 before the guest public-channel fence needed five
 * lines, and §1's rule is that a file at the cap cannot absorb a change — least
 * of all a comment). This is the seam that was already drawn: the file carried
 * these under their own `─── Workspace membership + profiles ───` banner,
 * separate from `─── Channels ───` and `─── Members ───`, precisely because they
 * answer a different question. Same shape as `repository-visibility.ts`,
 * `repository-messages.ts`, `repository-tasks.ts`, `repository-collab.ts`.
 *
 * ⚠ RE-EXPORTED FROM `repository.ts` (§1: keep the barrel if callers import
 * through it) — every caller in this feature does `import * as repo from
 * "./repository"`, so nothing moved from their point of view.
 *
 * ⚠ Service-role admin client (RLS-BYPASSING), like every sibling: visibility
 * and authz are the SERVICE layer's, never this layer's.
 */

/** True when the user is an ACTIVE member of the workspace (invitee gate). */
export async function isActiveWorkspaceMember(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function fetchProfiles(userIds: string[]): Promise<ProfileRef[]> {
  if (userIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .in("id", userIds);
  if (error) throw error;
  return (data ?? []) as ProfileRef[];
}
