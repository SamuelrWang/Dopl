import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * GET /api/cron/oauth-cleanup
 *
 * Scheduled purge of dead OAuth rows so the tables don't grow unbounded:
 *   1. Authorization codes past expiry (consumed or not) — short-lived,
 *      safe to drop a day after they expire.
 *   2. Fully-dead tokens: refresh token expired (access expires before
 *      refresh, so this means the whole grant is unusable).
 *   3. Tokens revoked more than 30 days ago (keep a recent grace window for
 *      audit/debugging).
 *
 * Auth: requires CRON_SECRET as a bearer token (same as the other cron
 * routes) so a random caller can't probe/poke it.
 */
const CODE_GRACE_DAYS = 1;
const REVOKED_GRACE_DAYS = 30;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const supabase = supabaseAdmin();
  const now = Date.now();
  const codeCutoff = new Date(now - CODE_GRACE_DAYS * 86400_000).toISOString();
  const revokedCutoff = new Date(
    now - REVOKED_GRACE_DAYS * 86400_000,
  ).toISOString();
  const nowIso = new Date(now).toISOString();

  const counts = {
    codes: 0,
    expired_tokens: 0,
    revoked_tokens: 0,
    rate_limit_events: 0,
  };
  try {
    const codes = await supabase
      .from("oauth_authorization_codes")
      .delete()
      .lt("expires_at", codeCutoff)
      .select("code_hash");
    counts.codes = codes.data?.length ?? 0;

    const expired = await supabase
      .from("mcp_tokens")
      .delete()
      .lt("refresh_expires_at", nowIso)
      .select("id");
    counts.expired_tokens = expired.data?.length ?? 0;

    const revoked = await supabase
      .from("mcp_tokens")
      .delete()
      .lt("revoked_at", revokedCutoff)
      .select("id");
    counts.revoked_tokens = revoked.data?.length ?? 0;

    // Rate-limit events only matter for a 60s window — purge anything older.
    const rl = await supabase
      .from("rate_limit_events")
      .delete()
      .lt("requested_at", new Date(now - 3600_000).toISOString())
      .select("id");
    counts.rate_limit_events = rl.data?.length ?? 0;
  } catch (err) {
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "GET /api/cron/oauth-cleanup",
      message: `OAuth cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      fingerprintKeys: ["oauth_cleanup_failed"],
    });
    return NextResponse.json({ error: "cleanup failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: counts });
}
