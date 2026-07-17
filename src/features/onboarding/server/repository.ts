import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Read the onboarding gate. A missing profiles row reads as "not
 * onboarded" — the row is created by signup hooks before any of this
 * runs, but be defensive rather than throw on the edge case.
 */
export async function findOnboardedAt(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .select("onboarded_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.onboarded_at as string | null) ?? null;
}

/**
 * Stamp onboarding completion. Conditional update (`onboarded_at IS
 * NULL`) so concurrent/repeat submits are no-ops; returns whether this
 * call won — callers use that to fire the completion event exactly
 * once (a single-writer idempotent-stamp pattern).
 */
export async function markOnboarded(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", userId)
    .is("onboarded_at", null)
    .select("id");
  if (error) throw error;
  return !!(data && data.length > 0);
}

/**
 * "Has this user's agent ever completed the OAuth dance?" — an
 * unrevoked mcp_tokens row. Point lookup on the partial index
 * mcp_tokens_user_active_idx. Deliberately NOT profiles.mcp_connected_at
 * (legacy heartbeat ping with a freshness window).
 */
export async function hasActiveMcpToken(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("mcp_tokens")
    .select("id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** display_name lookup for the workspace-naming fallback chain. */
export async function findDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.display_name as string | null) ?? null;
}
