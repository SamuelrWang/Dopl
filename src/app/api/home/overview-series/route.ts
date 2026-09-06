import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  getHomeOverviewSeries,
  parseMetric,
  parseRange,
} from "@/features/home/server/service-overview";

interface Ctx {
  userId: string;
}

const SOURCE = "api/home/overview-series";

/**
 * GET `?range=24h|7d|30d|month&metric=credits|mcp|messages` — the /home Overview
 * histogram's `HomeOverviewSeries`, oldest bin first.
 *
 * ⚠ **A SECOND ROUTE BECAUSE `metric` IS A PARAMETER THE USER SWITCHES**, which
 * is the same reason `…/overview-series` exists on the workspace side (§9). It
 * is NOT a second view of `./overview` — folding it in would refetch every scan
 * on the face each time somebody toggled a chart.
 *
 * ⚠ **AN UNRECOGNISED `range` OR `metric` IS A 400, NEVER A DEFAULT SERIES.** A
 * chart that answers a question nobody asked is worse than an error.
 *
 * ⚠ **`credits` LANDED 2026-09-01 AND THIS DOCBLOCK USED TO SAY IT COULD NOT
 * EXIST.** That was true of `workspace_credit_usage`, a one-row-per-period
 * COUNTER; it is not true of `credit_usage_events`, the attribution ledger added
 * beside it (`20260901120000_credit_usage_events.sql`, closing F-328). The arm
 * SUMS rather than counts, so it hauls the window once and reports `truncated`,
 * and it answers an EMPTY `points` array — never zeroed bins — when the ledger
 * holds nothing for the window, because there is no history behind the
 * migration.
 *
 * ⚠ **STILL NO `tokens` METRIC HERE, AND IT IS NO LONGER BECAUSE THE DATA
 * CANNOT EXIST** (corrected 2026-09-06, Samuel #1326). The old reason —
 * `channel_sessions.tokens_spent` is a live per-session snapshot the desktop
 * overwrites in place, so any timestamp on that row bins a running total at one
 * instant — was true of that table and is still true of it. The durable ledger
 * beside it (`workspace_token_spend`, migration 20260927120000) keys one row per
 * session RUN and so bins honestly. It has its OWN route,
 * `/api/home/token-spend`, rather than a fourth `metric` here: this endpoint's
 * three metrics all sum `credit_usage_events`, and a metric reading a different
 * table through the same `parseMetric` door would make one signature answer for
 * two ledgers with two accuracy stories. ⚠ Tokens are a FLOOR (quantized, and
 * an ended run's last stretch is never pushed); credits are exact. Those do not
 * belong on one axis without a label saying so.
 *
 * 🔒 **NO `workspaceId` — the face is cross-channel** (see `./overview`, which
 * carries why the param was removed).
 */
export const GET = withUserAuth(
  async (request: NextRequest, { userId }: Ctx) => {
    try {
      const params = request.nextUrl.searchParams;
      const range = parseRange(params.get("range"));
      const metric = parseMetric(params.get("metric"));
      const series = await getHomeOverviewSeries(userId, range, metric);
      return NextResponse.json(series, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse(SOURCE, err);
    }
  }
);
