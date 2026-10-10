/**
 * 🔒 **THE /home CREDIT HISTOGRAM, OVER A MONTH BIGGER THAN ONE POSTGREST PAGE
 * (Samuel #2935).** `service-overview.ts` used to haul raw ledger rows NEWEST
 * FIRST and bin them in JS, and `supabase/config.toml › max_rows` clips a select
 * silently — so on 2026-10-10 the graph drew ~1,000 credits, all dated today,
 * beside a spend card reading October's true 4,288. Today alone held 2,175 rows,
 * which is the whole mechanism: the clip never reached Oct 1-9. The fix is
 * server-side aggregation (`home_credit_usage_bins`), and these are its pins.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** — see
 * `_fake-credit-db.ts`, and `channels/server/repository-artifacts-spans.test.ts`
 * for the same finding one table over (F-712). **The 4,288-credit month is the
 * whole finding, executable: the haul it replaced returns 1,000 credits on one
 * day, and the aggregate returns 4,288 across eight.**
 *
 * ⚠ **ITS OWN FILE, BESIDE `service-overview.test.ts` RATHER THAN INSIDE IT** —
 * that suite's header states its reads are deliberately NOT exercised, which is
 * exactly why this finding needs a file: the bug was invisible to a pure tally
 * test because the tally was correct over the rows it was handed. The clip is
 * the subject here. ⚠ And it asserts WHAT WAS ASKED, not only what came back:
 * the wallet fence is `p_payer_user_id` and a fence is invisible in a return
 * value — an aggregate summing every wallet would pass every total below.
 *
 * MUTATION-VERIFY: put the JS fold back (read the table, bin in TypeScript) and
 * the month case fails; revert `clipped()` to compare against the asked `limit`
 * and the silent-clip case fails; drop the `Date`-normalising of `bin_start` and
 * every bin reads 0; drop `p_payer_user_id` from the call and the fence case
 * fails; drop the `Number(...)` coercion and the bigint case fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { getHomeOverviewSeries } from "./service-overview";
import { POSTGREST_MAX_ROWS } from "./repository-overview";
import {
  CHAN_A,
  CHAN_B,
  FOREIGN_WS,
  MAX_ROWS,
  NOW,
  OCTOBER,
  OCTOBER_TOTAL,
  OTHER,
  OWNED_WS,
  VIEWER,
  fakeDb,
  octoberLedger,
  row,
  total,
} from "./_fake-credit-db";

beforeEach(() => vi.mocked(supabaseAdmin).mockReset());

describe("credit histogram over a month bigger than one PostgREST page", () => {
  it("sums THE WHOLE MONTH, not the newest max_rows of it", async () => {
    const ledger = octoberLedger();
    // The precondition that made this a ghost rather than a rounding error.
    expect(ledger.length).toBeGreaterThan(MAX_ROWS);
    expect(OCTOBER_TOTAL).toBe(4288);
    fakeDb(ledger);

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    expect(total(series.points)).toBe(OCTOBER_TOTAL);
    expect(series.truncated).toBe(false);
  });

  it("puts every day's credits on ITS OWN bar", async () => {
    fakeDb(octoberLedger());

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });
    const byDay = new Map(
      series.points.map((p) => [new Date(p.at).getUTCDate(), p.count])
    );

    for (const [day, credits] of OCTOBER) {
      expect(byDay.get(day), `Oct ${day}`).toBe(credits);
    }
    // ⚠ The bug's signature: everything on today and nothing before it.
    expect(byDay.get(10)).not.toBe(total(series.points));
  });

  it("keeps the axis — 31 bins, quiet days zero-filled, never an empty array", async () => {
    fakeDb(octoberLedger());

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    expect(series.points).toHaveLength(31);
    // Oct 3 and 6 have no ledger rows at all; Oct 31 is in the future.
    for (const day of [3, 6, 31]) {
      const point = series.points.find(
        (p) => new Date(p.at).getUTCDate() === day
      );
      expect(point?.count, `Oct ${day}`).toBe(0);
    }
  });

  it("reads the aggregate and NEVER hauls the ledger table", async () => {
    const { calls } = fakeDb(octoberLedger());

    await getHomeOverviewSeries(VIEWER, "month", "credits", { now: NOW });

    expect(calls.some((c) => c.op === "rpc")).toBe(true);
    expect(
      calls.filter((c) => c.op === "from" && c.args[0] === "credit_usage_events")
    ).toHaveLength(0);
  });

  it("coerces the aggregate's bigint STRING into a number", async () => {
    fakeDb(octoberLedger());

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    for (const point of series.points) expect(typeof point.count).toBe("number");
    // String concatenation would make this a very long string, not 4288.
    expect(total(series.points)).toBe(4288);
  });
});

describe("the wallet fence is an ARGUMENT, and it is asserted", () => {
  it("asks for the reader's own payer id and owned containers", async () => {
    const { calls } = fakeDb(octoberLedger());

    await getHomeOverviewSeries(VIEWER, "month", "credits", { now: NOW });

    const rpc = calls.find((c) => c.op === "rpc");
    expect(rpc?.args[0]).toBe("home_credit_usage_bins");
    const args = rpc?.args[1] as Record<string, unknown>;
    expect(args.p_payer_user_id).toBe(VIEWER);
    expect(args.p_owned_container_ids).toEqual([OWNED_WS]);
    expect(args.p_bucket).toBe("day");
    expect(args.p_channel_scope).toBe("all");
    // Half-open over the whole calendar month.
    expect(args.p_since).toBe("2026-10-01T00:00:00.000Z");
    expect(args.p_until).toBe("2026-11-01T00:00:00.000Z");
  });

  it("bounds a PAST month at BOTH ends, so an old anchor cannot return this month's rows", async () => {
    const { calls } = fakeDb([
      row({ created_at: "2026-09-15T10:00:00.000Z" }),
      row({ created_at: "2026-10-10T10:00:00.000Z" }),
    ]);

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
      monthAnchor: new Date("2026-09-20T00:00:00.000Z"),
    });

    const args = calls.find((c) => c.op === "rpc")?.args[1] as Record<
      string,
      unknown
    >;
    expect(args.p_since).toBe("2026-09-01T00:00:00.000Z");
    expect(args.p_until).toBe("2026-10-01T00:00:00.000Z");
    // September has 30 bins, and October's row is OUTSIDE the window.
    expect(series.points).toHaveLength(30);
    expect(total(series.points)).toBe(1);
  });

  it("counts a LEGACY workspace row in a container the reader owns, and not one elsewhere", async () => {
    fakeDb([
      row({
        wallet: "workspace",
        payer_user_id: null,
        origin_workspace_id: OWNED_WS,
      }),
      row({
        wallet: "workspace",
        payer_user_id: null,
        origin_workspace_id: FOREIGN_WS,
      }),
    ]);

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    expect(total(series.points)).toBe(1);
  });

  it("drops a personal row somebody ELSE paid for, and a seat row", async () => {
    fakeDb([
      row({ payer_user_id: OTHER }),
      row({ wallet: "seat" }),
      row({ payer_user_id: VIEWER }),
    ]);

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    expect(total(series.points)).toBe(1);
  });

  it("counts a PEER's burn out of the reader's wallet — the payer is the fence, not the caller", async () => {
    fakeDb([row({ user_id: OTHER, payer_user_id: VIEWER })]);

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    expect(total(series.points)).toBe(1);
  });
});

describe("the channel narrowing partitions the wallet", () => {
  const mixed = () => [
    row({ channel_id: CHAN_A }),
    row({ channel_id: CHAN_B }),
    row({ channel_id: null }),
  ];

  it("narrows to one channel", async () => {
    fakeDb(mixed());
    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
      scope: CHAN_A,
    });
    expect(total(series.points)).toBe(1);
  });

  it("narrows to the Desktop agent — channel_id IS NULL", async () => {
    const { calls } = fakeDb(mixed());
    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
      scope: "desktop",
    });
    const args = calls.find((c) => c.op === "rpc")?.args[1] as Record<
      string,
      unknown
    >;
    expect(args.p_channel_scope).toBe("unattributed");
    expect(total(series.points)).toBe(1);
  });

  it("no narrowing is the WHOLE wallet, Desktop-agent burns included", async () => {
    fakeDb(mixed());
    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });
    expect(total(series.points)).toBe(3);
  });
});

describe("the degrade, when the migration has not been applied", () => {
  it("still draws a graph rather than a blank one", async () => {
    fakeDb(octoberLedger(), { rpcMissing: true });

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    expect(series.points).toHaveLength(31);
    expect(total(series.points)).toBeGreaterThan(0);
  });

  it("REPORTS the clip it used to hide — the silent-truncation bug itself", async () => {
    fakeDb(octoberLedger(), { rpcMissing: true });

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    // 🔒 THE REGRESSION. `clipped()` compared `rows.length >= limit` with limit
    // asking 20,000, so a 1,000-row server clip read as a COMPLETE month and the
    // surface's floor banner could never fire on the one read that was a floor.
    expect(series.truncated).toBe(true);
    // And the clipped haul really is short of the month — which is why the
    // banner has to fire rather than the number being quietly trusted.
    expect(total(series.points)).toBeLessThan(OCTOBER_TOTAL);
    expect(total(series.points)).toBe(MAX_ROWS);
  });

  it("falls back to the LEDGER TABLE, newest-first, when the aggregate is gone", async () => {
    const { calls } = fakeDb(octoberLedger(), { rpcMissing: true });

    await getHomeOverviewSeries(VIEWER, "month", "credits", { now: NOW });

    expect(
      calls.some((c) => c.op === "from" && c.args[0] === "credit_usage_events")
    ).toBe(true);
    // ⚠ The pushdown's own text, pinned where the fake deliberately does not
    // parse it: both wallet arms must still reach PostgREST on this path.
    const or = calls.find((c) => c.op === "or")?.args[0] as string;
    expect(or).toContain(`payer_user_id.eq.${VIEWER}`);
    expect(or).toContain("wallet.eq.personal");
    expect(or).toContain("wallet.eq.workspace");
    expect(or).toContain(OWNED_WS);
  });
});

describe("the ceiling constant", () => {
  it("is the one supabase/config.toml actually states", () => {
    // ⚠ Raising the server setting without moving this number would restore the
    // silent clip for every read that still hauls.
    expect(POSTGREST_MAX_ROWS).toBe(MAX_ROWS);
  });
});
