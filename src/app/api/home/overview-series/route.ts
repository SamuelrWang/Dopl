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
 * 🔒 **`channel` AND `month` ARE THE USAGE CARD'S TWO CONTROLS, AND THEY ARE
 * PARAMETERS ON THIS ROUTE RATHER THAN A SECOND ENDPOINT (Samuel, 2026-09-13:
 * *"a dropdown where the user can select: all channels / specific channels / just
 * desktop agent usage … a left and right arrow that will let me change the month
 * I'm looking at, specifically for the bar graph"*).** Same reason `metric` is
 * one: they are things the reader switches, and the cache keys on the path.
 * ⚠ **BOTH ARE NARROWINGS OF THE `credits` ARM AND NEITHER IS A FENCE** —
 * `overview-series-params.ts` carries the whole argument, including why an
 * unowned container id answers a zero-filled month instead of a 400 and why a
 * `month` beside a ROLLING range is refused outright.
 * ⚠ **THE CREDIT *BAR* IS NOT ON THIS ENDPOINT** and is untouched by either
 * control: it reads `GET /api/billing/status`, always the CURRENT period.
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
 * SUMS rather than counts, so it hauls the window once and reports `truncated`.
 * ⚠ **AND IT ZERO-FILLS LIKE THE OTHER TWO** — the superseded sentence here said
 * it "answers an EMPTY `points` array — never zeroed bins" on an empty window;
 * Samuel overruled that (`service-overview.ts › getHomeOverviewSeries`: the axis
 * is the frame and the page never loses it).
 *
 * 🔒 **AND THE `credits` METRIC IS THE READER'S OWN PERSONAL WALLET, NOT EVERY
 * CONTAINER THEY BURNED IN (Samuel, 2026-09-12: "is the credits usage wired in?
 * I want to make sure").** It selected `origin_workspace_id IN (every home
 * channel the caller had joined)`, which sums a quantity no wallet holds — a link
 * container's burns (the caller's personal wallet) PLUS a standard workspace's
 * (somebody's SEAT wallet) — so this series and `GET /api/billing/status ›
 * credits.used` disagreed by construction on one card. The arm now selects
 * `payer_user_id = caller AND wallet = 'personal'`, plus the LEGACY
 * `wallet = 'workspace'` rows whose origin container the caller OWNS
 * (`features/home/server/overview-tally.ts › isPersonalWalletBurn`). ⚠ Burns in a
 * standard workspace are gone from this endpoint on purpose: they are that
 * workspace's Overview's figure, `/api/workspaces/.../overview-series`'s.
 * ⚠ `mcp` and `messages` are unchanged — those really are per-channel questions.
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
