import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { DEVICE_CLIENT_ID } from "@/shared/auth/mcp-credential";
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
 *   4. Orphan OAuth clients: rows from RFC 7591 dynamic client registration
 *      that never completed a grant (zero associated tokens) and are older
 *      than the grace window. `/api/oauth/register` is unauthenticated, so
 *      this is the second half of bounding its table growth (the first is the
 *      per-IP limiter on the endpoint itself).
 *
 * Auth: requires CRON_SECRET as a bearer token (same as the other cron
 * routes) so a random caller can't probe/poke it.
 */
const CODE_GRACE_DAYS = 1;
const REVOKED_GRACE_DAYS = 30;
/**
 * How old a token-less client must be before it's reaped. The auth-code →
 * token exchange completes in minutes, so a client with zero tokens after a
 * week never completed a grant (or had all its tokens pruned by steps 2–3,
 * which only fire 30+ days after a grant dies — so such a client is even older
 * and certainly dead). Seven days leaves a real register-then-authorize-later
 * client ample time to finish while still bounding orphan accumulation to at
 * most a week of (now rate-limited) registrations.
 */
const CLIENT_ORPHAN_GRACE_DAYS = 7;
/** Cap orphan clients reaped per run so a first cleanup can't run unbounded;
 *  subsequent runs drain any remaining backlog. */
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

    // Rate-limit events only matter for a 60s window — purge anything older.
    const rl = await supabase
      .from("rate_limit_events")
      .delete()
      .lt("requested_at", new Date(now - 3600_000).toISOString())
      .select("id");
    counts.rate_limit_events = rl.data?.length ?? 0;

    // Orphan OAuth clients: registered via DCR but never completed a grant.
    // Fetch old candidate rows first (excluding the reserved first-party device
    // client, whose token count can momentarily be zero between re-mints), then
    // drop only those with no `mcp_tokens` referencing them. `oauth_clients` has
    // an ON DELETE CASCADE to `oauth_authorization_codes`, so any in-flight code
    // (5-min TTL, long gone at this age) is swept with its client. Both reads
    // are bounded by the candidate set, and the delete is a no-op when empty.
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
