import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  getHomeOverviewSeries,
  parseMetric,
  parseRange,
} from "@/features/home/server/service-overview";
import {
  parseUsageMonth,
  parseUsageScope,
} from "@/features/home/server/overview-series-params";

interface Ctx {
  userId: string;
}

const SOURCE = "api/home/overview-series";

/**
 * GET `?range=24h|7d|30d|month&metric=credits|mcp|messages[&channel=<id>|desktop][&month=YYYY-MM]`
 * — the /home Overview histogram's `HomeOverviewSeries`, oldest bin first.
 *
 * 🔒 `channel` and `month` are the usage card's two controls, as params rather
 * than a second endpoint (Samuel, 2026-09-13). ⚠ Both narrow the `credits` arm;
 * neither is a fence — `overview-series-params.ts` carries the argument. The
 * credit BAR is not here: it reads `GET /api/billing/status` (current period).
 *
 * ⚠ Separate from `./overview` because `metric` is user-switched (§9); folding
 * it in would refetch every scan per toggle. Unrecognised `range`/`metric` → 400,
 * never a default series. All arms zero-fill (Samuel; see
 * `service-overview.ts › getHomeOverviewSeries`).
 *
 * 🔒 `credits` (sums `credit_usage_events`, F-328) = the reader's own PERSONAL
 * wallet (Samuel, 2026-09-12), so it
 * agrees with `/api/billing/status › credits.used`: `payer_user_id = caller AND
 * wallet = 'personal'` plus legacy `wallet = 'workspace'` rows in containers the
 * caller owns (`overview-tally.ts › isPersonalWalletBurn`). Standard-workspace
 * burns belong to that workspace's overview-series. `mcp`/`messages` stay
 * per-channel.
 *
 * ⚠ No `tokens` metric: tokens live in `workspace_token_spend` and have their own
 * route (`/api/home/token-spend`, Samuel #1326) — a different ledger with a
 * different accuracy story (tokens are a FLOOR; credits are exact).
 *
 * 🔒 No `workspaceId` — the face is cross-channel (see `./overview`).
 */
export const GET = withUserAuth(
  async (request: NextRequest, { userId }: Ctx) => {
    try {
      const params = request.nextUrl.searchParams;
      const range = parseRange(params.get("range"));
      const metric = parseMetric(params.get("metric"));
      const scope = parseUsageScope(params.get("channel"));
      const monthAnchor = parseUsageMonth(params.get("month"), range);
      const series = await getHomeOverviewSeries(userId, range, metric, {
        scope,
        monthAnchor,
      });
      return NextResponse.json(series, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse(SOURCE, err);
    }
  }
);
