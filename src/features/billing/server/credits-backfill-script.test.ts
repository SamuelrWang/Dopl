/**
 * `scripts/sql/backfill-credit-wallets-v2.sql`, READ AS THE CONTRACT IT IS.
 *
 * 🔒 **THE RULING IT SERVES (Samuel, 2026-09-13): THE HISTOGRAM MUST EQUAL THE
 * WALLET, ALWAYS** (F-693). The script is the deploy-day catch-up that seeds the
 * two v2.1 wallets from the attribution ledger, and it is the ONE hand-run
 * artifact that can put the counter and the ledger out of step.
 *
 * ⚠ **NOT A REPLAY** — no database runs here. What a SQL-text test can honestly
 * prove is that the file still SAYS what makes it safe to run twice, and that it
 * has not drifted back to the three shapes that were wrong under rule B:
 *
 *   1. **LEGACY ROWS ONLY (`wallet = 'workspace'`).** A v2.1 row already moved
 *      its counter inside `consume_user_credits` / `consume_member_credits`, so
 *      re-deriving a counter from it is at best a no-op. ⚠ **AND AT WORST A LOST
 *      BALANCE**: the ledger row records the ADDRESSED container and a seat
 *      burn's CHARGED workspace appears on it NOWHERE (rule B arm 2), so an
 *      absolute `SET used = <sum over origin>` dropped every cross-container seat
 *      burn and wrote a `workspace_member_credit_usage` row keyed on a
 *      `kind='personal'` container besides.
 *   2. **ADDITIVE, NOT ABSOLUTE.** Legacy spend was never counted, so it is added
 *      to whatever the atomic RPCs have already charged this period.
 *   3. **IT LABELS THE ROWS IT COUNTED**, which is what makes (2) idempotent
 *      *and* what stops `credit_ledger_sum` reporting the whole backfill as
 *      drift: that function keys on `(payer_user_id, wallet, period_start)` and a
 *      `wallet='workspace'` row carries neither, so every seeded counter would
 *      have read as `Unreconciled` on /home for the rest of the month.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PATH = resolve(
  process.cwd(),
  "scripts",
  "sql",
  "backfill-credit-wallets-v2.sql"
);
const sql = readFileSync(PATH, "utf8");
/** Header prose with the `--` line noise folded out, so a rule that wraps across
 *  two comment lines still reads as one sentence. */
const prose = sql.replace(/\n--\s*>?\s*/g, " ");
/** The statements only — what running the file actually executes. */
const live = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("the header carries what an operator needs before running it", () => {
  it("says it is a person's decision and never a scheduled repair loop", () => {
    expect(prose).toContain("never be scheduled");
  });

  it("names the drift figure as the way a residual disagreement is noticed", () => {
    expect(prose).toContain("ledgerDrift");
  });

  it("warns that the SUPERSEDED absolute form must not be re-run alongside it", () => {
    // ⚠ The two shapes are not interchangeable: the old one SET the counter, this
    // one ADDS to it. Running the old one first and this one after double-counts.
    expect(prose).toMatch(/SET .*(superseded|absolute)|absolute .*superseded/i);
  });
});

describe("🔒 it reads LEGACY rows only — a v2.1 row's counter is already moved", () => {
  it("narrows the scan to `wallet = 'workspace'`", () => {
    expect(live).toMatch(/WHERE\s+e\.wallet\s*=\s*'workspace'/);
  });

  it("does not derive a wallet label from a row that already carries one", () => {
    // The superseded `COALESCE(NULLIF(e.wallet, 'workspace'), CASE …)` is what
    // let a v2.1 `seat` row through to be re-keyed on its ORIGIN container.
    expect(live).not.toContain("NULLIF(e.wallet");
  });

  it("keys a seat counter on the ORIGIN only because a legacy row has no other container", () => {
    // Rule B did not exist when these rows were written, so origin IS the charged
    // container for every one of them. The comment is the reason; the filter above
    // is the fence.
    expect(prose).toMatch(/rule B did not exist/i);
  });
});

describe("🔒 it ADDS to the counters and LABELS the rows it counted", () => {
  it("both upserts accumulate rather than overwrite", () => {
    const adds = live.match(/SET used = u\.used \+ EXCLUDED\.used/g) ?? [];
    expect(adds).toHaveLength(2);
    expect(live).not.toContain("SET used = EXCLUDED.used");
  });

  it("stamps `wallet` and `payer_user_id` on every row it charged", () => {
    expect(live).toMatch(/UPDATE public\.credit_usage_events/);
    expect(live).toContain("payer_user_id =");
  });

  it("is one transaction, so the labels and the counters land together", () => {
    expect(live).toContain("BEGIN;");
    expect(live).toContain("COMMIT;");
    // ⚠ ONE statement, so every CTE reads the SAME pre-update snapshot: the
    // aggregates cannot see the labels the same statement is writing.
    expect(live.match(/^WITH /gm) ?? []).toHaveLength(1);
  });

  it("reports what it labelled, not only what it wrote", () => {
    expect(live).toContain("ledger_rows_labelled");
  });
});

describe("🔒 the period key is UTC, the calendar both wallets stamp", () => {
  it("never truncates `now()` in the session's own timezone", () => {
    // `date_trunc('month', now())` is the SESSION timezone's month; both period
    // rules stamp the UTC one (`../credits.ts › calendarMonth`). On a non-UTC
    // session the two keys differ and the backfill matches nothing.
    expect(live).not.toMatch(/date_trunc\('month',\s*now\(\)\)/);
  });

  it("groups by the row's own stamped period rather than assuming a month", () => {
    // A PAID wallet's period is the Stripe anchor, not the 1st — a current-month
    // filter silently skipped every payer.
    expect(live).toContain("period_start");
    expect(live).toMatch(/GROUP BY/);
  });
});
