import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { DEVICE_CLIENT_ID } from "@/shared/auth/mcp-credential";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * GET /api/cron/oauth-cleanup — scheduled purge of dead OAuth rows:
 *   1. authorization codes past expiry (short-lived, safe a day after);
 *   2. fully-dead tokens (refresh expired ⇒ the whole grant is unusable);
 *   3. tokens revoked >30 days ago (grace window for audit);
 *   4. orphan OAuth clients — DCR rows that never completed a grant, older than the grace window.
 *      `/api/oauth/register` is unauthenticated, so this is the second half of bounding its table
 *      growth (the first is that endpoint's per-IP limiter).
 * Auth: CRON_SECRET bearer.
 */
const CODE_GRACE_DAYS = 1;
const REVOKED_GRACE_DAYS = 30;
/** Age before a token-less client is reaped. The code→token exchange completes in minutes, so
 *  zero tokens after a week means the grant never completed (or its tokens were pruned by steps
 *  2-3, which fire 30+ days after death). Bounds orphan accumulation to a week. */
const CLIENT_ORPHAN_GRACE_DAYS = 7;
/** Cap per run so a first cleanup cannot run unbounded; later runs drain the backlog. */
const ORPHAN_CLIENT_SCAN_LIMIT = 500;

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
  const clientCutoff = new Date(
    now - CLIENT_ORPHAN_GRACE_DAYS * 86400_000,
  ).toISOString();
  const nowIso = new Date(now).toISOString();

  const counts = {
    codes: 0,
    expired_tokens: 0,
    revoked_tokens: 0,
    rate_limit_events: 0,
    orphan_clients: 0,
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

    // Rate-limit events matter for a 60s window only.
    const rl = await supabase
      .from("rate_limit_events")
      .delete()
      .lt("requested_at", new Date(now - 3600_000).toISOString())
      .select("id");
    counts.rate_limit_events = rl.data?.length ?? 0;

    // ⚠ Exclude the reserved first-party device client from the candidate scan — its token count
    // is momentarily zero between re-mints. Candidates first, then drop only those with no
    // `mcp_tokens`. `oauth_clients` ON DELETE CASCADEs to `oauth_authorization_codes`, so any
    // in-flight code (5-min TTL) is swept with its client.
    const candidates = await supabase
      .from("oauth_clients")
      .select("client_id")
      .lt("created_at", clientCutoff)
      .neq("client_id", DEVICE_CLIENT_ID)
      .limit(ORPHAN_CLIENT_SCAN_LIMIT);
    const candidateIds = (candidates.data ?? []).map((r) => r.client_id as string);
    if (candidateIds.length > 0) {
      const tokened = await supabase
        .from("mcp_tokens")
        .select("client_id")
        .in("client_id", candidateIds);
      const withTokens = new Set(
        (tokened.data ?? []).map((r) => r.client_id as string),
      );
      const orphanIds = candidateIds.filter((id) => !withTokens.has(id));
      if (orphanIds.length > 0) {
        const reaped = await supabase
          .from("oauth_clients")
          .delete()
          .in("client_id", orphanIds)
          .select("client_id");
        counts.orphan_clients = reaped.data?.length ?? 0;
      }
    }
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
