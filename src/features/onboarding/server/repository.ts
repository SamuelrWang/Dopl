import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/** Onboarding gate. Missing profiles row reads as "not onboarded" (signup
 *  hooks create it first; defensive, not expected). */
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
 * Stamp onboarding completion. ⚠ Conditional update (`onboarded_at IS NULL`)
 * makes concurrent/repeat submits no-ops; return value = "this call won", which
 * callers use to fire the completion event exactly once.
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
 * Agent ever completed the OAuth dance? = unrevoked mcp_tokens row. Point
 * lookup on partial index mcp_tokens_user_active_idx. ⚠ Deliberately NOT
 * profiles.mcp_connected_at (legacy heartbeat with a freshness window).
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

/** display_name for the workspace-naming fallback chain. */
export async function findDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.display_name as string | null) ?? null;
}
