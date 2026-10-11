import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

export interface ProfileSummary {
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Batch profile lookup for member-list hydration — one query, not a per-user
 * `auth.admin.getUserById` loop.
 */
export async function listProfileSummaries(
  userIds: string[]
): Promise<Map<string, ProfileSummary>> {
  const out = new Map<string, ProfileSummary>();
  if (userIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .in("id", userIds);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    id: string;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
  }>) {
    out.set(row.id, {
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    });
  }
  return out;
}
