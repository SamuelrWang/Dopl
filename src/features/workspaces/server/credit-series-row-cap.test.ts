/**
 * 🔒 **THE WORKSPACE OVERVIEW'S CREDIT SERIES, OVER A MONTH BIGGER THAN ONE
 * POSTGREST PAGE (Samuel #2935, the `max_rows` sweep).**
 * `readWorkspaceCreditBins` asked `scanWorkspaceCreditEvents` for
 * `WORKSPACE_SCAN_LIMIT` (10,000) raw ledger rows NEWEST FIRST and binned them in
 * JS; `supabase/config.toml › max_rows` clips a select server-side at 1,000 and
 * raises NOTHING. Two wrong answers out of that one line:
 *
 *   1. **THE BARS.** The newest 1,000 burns of a calendar month came back, so a
 *      container whose busiest days exceed the cap drew its older bars as ZEROES
 *      — a measurement nobody took, rendered as fact — beside a spend card
 *      reading the month's true total.
 *   2. **THE MARKER.** `clipped()` computed `truncated = rows.length >= limit`,
 *      and `1000 >= 10000` is **false**, so the one read that WAS a floor
 *      reported itself COMPLETE and no clip banner could fire. ⚠ This is why a
 *      bigger `max_rows` was never the fix: it moves the number, keeps the silence.
 *
 * The fix is `workspace_credit_usage_bins` — one row per UTC bin, so the ceiling
 * sits two orders of magnitude from the data and a busy day cannot push it back
 * out. The haul survives as the degrade while the migration is unapplied, which
 * is the LIVE path and is driven here too.
 *
 * ⚠ Fixtures, the fake's clip and the honest RPC handler: `_fake-usage-db.ts`.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - skip the aggregate and keep the haul → "sums the WHOLE month" fails.
 *  - revert `clipped()` to compare against the asked `limit` → "REPORTS the clip
 *    it used to hide" fails.
 *  - drop the `Date`-normalising of `bin_start` → every bin reads 0.
 *  - drop `p_channel_ids` from the call → "counts a rule-B arm-2 burn" fails.
 *  - drop the wallet `.in()` or either `.or()` arm on the degrade path → "falls
 *    back to the LEDGER TABLE with both pushdown arms intact" fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { MAX_ROWS } from "@/shared/testing/postgrest-cap";
import {
  CHAN_A,
  CHAN_B,
  FOREIGN_WS,
  MONTH_TOTAL,
  PER_DAY,
  SINCE,
  UNTIL,
  WS,
  burn,
  chain,
  monthBins,
  mount,
  octoberLedger,
} from "./_fake-usage-db";
import type { Args } from "./_fake-usage-db";
import { readWorkspaceCreditBins } from "./service-usage";

beforeEach(() => vi.clearAllMocks());

describe("the credit series over a month bigger than one PostgREST page", () => {
  /** 🔒 **THE CONTROL, AND WITHOUT IT EVERY CASE BELOW PROVES NOTHING.** It shows
   *  the harness really clips a one-statement read at `max_rows`, so the shape
   *  these reads replaced answered the newest 1,000 of 2,400 burns. */
  it(`⚠ the old 10,000-row ask still comes back as exactly ${MAX_ROWS}, silently`, async () => {
    const ledger = octoberLedger();
    expect(ledger).toHaveLength(MONTH_TOTAL);
    expect(MONTH_TOTAL).toBeGreaterThan(MAX_ROWS);
    const { client } = mount({ ledger });

    const { data, error } = await chain(client)
      .from("credit_usage_events")
      .select("amount, created_at")
      .in("wallet", ["seat", "workspace"])
      .order("created_at", { ascending: false })
      .limit(10_000);

    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
  });

  it("sums the WHOLE month, not the newest max_rows of it", async () => {
    mount({ ledger: octoberLedger() });

    const { counts, truncated } = await readWorkspaceCreditBins(
      WS,
      monthBins()
    );

    expect(counts.reduce((a, b) => a + b, 0)).toBe(MONTH_TOTAL);
    expect(truncated).toBe(false);
  });

  it("puts every day's credits on ITS OWN bar, and keeps the 31-bin axis", async () => {
    mount({ ledger: octoberLedger() });

    const { counts } = await readWorkspaceCreditBins(WS, monthBins());

    expect(counts).toHaveLength(31);
    for (const [day, burns] of PER_DAY) {
      expect(counts[day - 1], `Oct ${day}`).toBe(burns);
    }
    // Oct 3, 6, 7 have no rows at all; Oct 11-31 are in the future.
    for (const day of [3, 6, 7, 11, 31]) {
      expect(counts[day - 1], `Oct ${day}`).toBe(0);
    }
    // ⚠ The bug's signature: everything on the newest day and nothing before it.
    expect(counts[9]).not.toBe(MONTH_TOTAL);
  });

  it("reads the aggregate and NEVER hauls the ledger table", async () => {
    const { calls } = mount({ ledger: octoberLedger() });

    await readWorkspaceCreditBins(WS, monthBins());

    expect(calls.some((c) => c.op === "rpc")).toBe(true);
    expect(
      calls.filter((c) => c.op === "from" && c.args[0] === "credit_usage_events")
    ).toHaveLength(0);
  });

  it("coerces the aggregate's bigint STRING into a number", async () => {
    mount({ ledger: octoberLedger() });
    const { counts } = await readWorkspaceCreditBins(WS, monthBins());
    for (const count of counts) expect(typeof count).toBe("number");
    expect(counts.reduce((a, b) => a + b, 0)).toBe(MONTH_TOTAL);
  });
});

describe("the series' fence is an ARGUMENT, and it is asserted", () => {
  it("names this container, its channels, both bounds and the bucket", async () => {
    const { calls } = mount({ ledger: octoberLedger() });

    await readWorkspaceCreditBins(WS, monthBins());

    const rpc = calls.find((c) => c.op === "rpc");
    expect(rpc?.args[0]).toBe("workspace_credit_usage_bins");
    const args = rpc?.args[1] as Args;
    expect(args.p_workspace_id).toBe(WS);
    expect(args.p_channel_ids).toEqual([CHAN_A, CHAN_B]);
    expect(args.p_bucket).toBe("day");
    expect(args.p_channel_id).toBeNull();
    // Half-open over the whole calendar month.
    expect(args.p_since).toBe(SINCE);
    expect(args.p_until).toBe(UNTIL);
  });

  it("counts a rule-B arm-2 burn — this container's CHANNEL, another origin", async () => {
    mount({
      ledger: [
        burn({ origin_workspace_id: FOREIGN_WS, channel_id: CHAN_A }),
        // ⚠ Neither arm: somebody else's container, somebody else's channel.
        burn({ origin_workspace_id: FOREIGN_WS, channel_id: null }),
      ],
    });

    const { counts } = await readWorkspaceCreditBins(WS, monthBins());

    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("REFUSES a personal-wallet burn addressed at this container", async () => {
    // Rule B arm 1: a home channel's agent spends its OWNER's wallet. That credit
    // is on /home's figure and on no figure here — summing the two was the
    // 2026-09-12 bug.
    mount({ ledger: [burn({ wallet: "personal" }), burn()] });

    const { counts } = await readWorkspaceCreditBins(WS, monthBins());

    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("narrows to ONE channel without becoming a fence of its own", async () => {
    const { calls } = mount({
      ledger: [burn({ channel_id: CHAN_A }), burn({ channel_id: CHAN_B })],
    });

    const { counts } = await readWorkspaceCreditBins(WS, monthBins(), CHAN_A);

    const args = calls.find((c) => c.op === "rpc")?.args[1] as Args;
    expect(args.p_channel_id).toBe(CHAN_A);
    expect(args.p_workspace_id).toBe(WS);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("the series degrades when the migration has not been applied", () => {
  it("still draws the 31-bin plot rather than a blank one", async () => {
    mount({ ledger: octoberLedger(), rpcMissing: true });

    const { counts } = await readWorkspaceCreditBins(WS, monthBins());

    expect(counts).toHaveLength(31);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  /** 🔒 **THE REGRESSION, EXECUTABLE.** `clipped()` compared `rows.length >=
   *  limit` with `limit` asking 10,000, so a 1,000-row server clip read as a
   *  COMPLETE month and the surface's floor banner could never fire on the one
   *  read that was a floor. */
  it(`REPORTS the clip it used to hide, and the haul really is short (${MAX_ROWS} of ${MONTH_TOTAL})`, async () => {
    mount({ ledger: octoberLedger(), rpcMissing: true });

    const { counts, truncated } = await readWorkspaceCreditBins(
      WS,
      monthBins()
    );

    expect(truncated).toBe(true);
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(MAX_ROWS);
    expect(total).toBeLessThan(MONTH_TOTAL);
  });

  it("falls back to the LEDGER TABLE with both pushdown arms intact", async () => {
    const { calls } = mount({ ledger: octoberLedger(), rpcMissing: true });

    await readWorkspaceCreditBins(WS, monthBins());

    expect(
      calls.some((c) => c.op === "from" && c.args[0] === "credit_usage_events")
    ).toBe(true);
    // ⚠ The pushdown's own TEXT, pinned where the fake deliberately does not
    // parse it: the wallet filter and both container arms must still reach
    // PostgREST on this path.
    expect(
      calls.find((c) => c.op === "in" && c.args[0] === "wallet")?.args[1]
    ).toEqual(["seat", "workspace"]);
    const or = calls.find((c) => c.op === "or")?.args[0] as string;
    expect(or).toContain(`origin_workspace_id.eq.${WS}`);
    expect(or).toContain(`channel_id.in.(${CHAN_A},${CHAN_B})`);
  });
});

