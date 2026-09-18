/**
 * `scripts/sql/backfill-credit-wallets-v2.sql`, read as the contract it is. The
 * deploy-day catch-up that seeds the two v2.1 wallets from the attribution
 * ledger, and the one hand-run artifact that can put counter and ledger out of
 * step (F-693; Samuel, 2026-09-13: the histogram must equal the wallet).
 *
 * Not a replay — no database runs here. What SQL text proves is that the file
 * still says what makes it safe to run twice, and has not drifted back to the
 * three shapes that were wrong under rule B:
 *
 *   1. Legacy rows only (`wallet = 'workspace'`). A v2.1 row already moved its
 *      counter inside the consume RPCs, and re-deriving from it loses balance:
 *      the ledger row records the ADDRESSED container, so an absolute
 *      `SET used = <sum over origin>` drops every cross-container seat burn.
 *   2. Additive, not absolute: legacy spend was never counted, so it is added to
 *      whatever the atomic RPCs already charged this period.
 *   3. It labels the rows it counted, which makes (2) idempotent and stops
 *      `credit_ledger_sum` — keyed on `(payer_user_id, wallet, period_start)` —
 *      reporting the whole backfill as drift.
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
    // The two shapes are not interchangeable: the old one SET the counter, this
    // one ADDS to it, so running both double-counts.
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
    // container for every one of them; the filter above is the fence.
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
    // One statement, so every CTE reads the same pre-update snapshot: the
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
