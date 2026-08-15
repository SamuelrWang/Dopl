import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Throttled last-active tracking. ⚠ `resolveMembershipOrThrow` calls this on
 * EVERY authenticated workspace request: the write fires at most once per
 * THROTTLE_MS per (workspace, user) and is never awaited, so the hot path pays
 * zero added reads or latency. Per-instance Map resets on cold start.
 */
const THROTTLE_MS = 5 * 60 * 1000;
const lastBump = new Map<string, number>();

export function touchLastSeen(
  workspaceId: string,
  userId: string,
  rowLastSeenAt: string | null
): void {
  const key = `${workspaceId}:${userId}`;
  const now = Date.now();
  if ((lastBump.get(key) ?? 0) > now - THROTTLE_MS) return;
  if (rowLastSeenAt) {
    const rowMs = new Date(rowLastSeenAt).getTime();
    if (rowMs > now - THROTTLE_MS) {
      lastBump.set(key, rowMs);
      return;
    }
  }
  lastBump.set(key, now);
  void supabaseAdmin()
    .from("workspace_members")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .then(({ error }) => {
      if (error) console.warn("[last-seen] bump failed:", error.message);
    });
}
