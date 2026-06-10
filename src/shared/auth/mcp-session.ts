import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Shared MCP-session helpers used by the OAuth auth path. Split out of the
 * old api-keys module (removed with the npx/stdio + API-key install path) so
 * the OAuth transport keeps its rate limiter and "MCP connected" indicator.
 */

/**
 * Atomic rate-limit check + record keyed by an arbitrary text subject, backed
 * by `check_and_record_rate_limit_subject` + the FK-free `rate_limit_events`
 * table. Used for OAuth access tokens ("mcp:<token_id>").
 *
 * Fails closed — if the DB call errors, the request is rejected.
 */
export async function checkAndRecordRateLimitSubject(
  subject: string,
  rpm: number,
  endpoint: string
): Promise<boolean> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.rpc(
    "check_and_record_rate_limit_subject",
    { p_subject: subject, p_rpm: rpm, p_endpoint: endpoint }
  );

  if (error) {
    console.error("[auth] Subject rate limit RPC failed:", error);
    return false; // Fail closed
  }

  return data === true;
}

/**
 * Refresh profiles.mcp_connected_at for an MCP user. Fire-and-forget.
 *
 * Every authenticated MCP call touches this timestamp. The settings
 * connection card polls `/api/user/mcp-status` to detect when the user has
 * connected their agent — any tool call advances the timestamp, so the card
 * flips to "connected" as soon as the agent does anything real.
 *
 * In-process debounce: only writes once every 30s per user. The debounce map
 * is intentionally unbounded-but-small (one entry per active user); process
 * restarts clear it harmlessly.
 */
const mcpStatusLastTouched = new Map<string, number>();
const MCP_STATUS_TOUCH_INTERVAL_MS = 30_000;

export function touchMcpStatus(userId: string): void {
  const now = Date.now();
  const last = mcpStatusLastTouched.get(userId) ?? 0;
  if (now - last < MCP_STATUS_TOUCH_INTERVAL_MS) return;
  mcpStatusLastTouched.set(userId, now);

  const supabase = supabaseAdmin();
  supabase
    .from("profiles")
    .update({ mcp_connected_at: new Date(now).toISOString() })
    .eq("id", userId)
    .then(({ error }) => {
      if (error) console.error("[auth] touchMcpStatus failed:", error);
    });
}
