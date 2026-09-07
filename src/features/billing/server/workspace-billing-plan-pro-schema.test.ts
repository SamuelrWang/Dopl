/**
 * INVARIANT SUITE — `20260930130000_workspace_billing_plan_pro.sql`, READ AS
 * THE CONTRACT IT IS.
 *
 * 🔒 **WHY A SUITE FOR FOUR STATEMENTS.** This file is the ONLY schema the
 * personal Pro tier needs, and the whole design rests on that: a
 * `kind='personal'` container is a real `workspaces` row, so its subscription
 * lives in `workspace_billing` keyed by the container id and every existing
 * Stripe path works unchanged (spec §11.1). If the CHECK and the TypeScript
 * union ever disagree, the failure is a `23514` raised INSIDE the Stripe
 * webhook — which Stripe then retries forever against a database that will
 * never accept the row, while the customer is already charged. Nothing else in
 * the tree notices.
 *
 * ⚠ Deploy state is a MEASUREMENT: `supabase migration list`, joined on the
 * NAME (INVARIANTS §12, F-304). This suite reads the FILE and says nothing
 * about what is applied.
 *
 * ⚠ Comments are stripped before the SQL assertions, because this header quotes
 * its own rollback and verification SQL at length — an unstripped scan would
 * pin the prose instead of the statements.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PlanId } from "../plans";
import type { WorkspaceBillingPlan } from "./workspace-billing";

const MIGRATIONS = resolve(process.cwd(), "supabase", "migrations");
const NAME = "20260930130000_workspace_billing_plan_pro.sql";
const TAXONOMY_V2 = "20260719000000_workspace_billing_plan_taxonomy_v2.sql";
const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), "utf8");

const raw = read(NAME);
/** Comments removed line-wise — the header quotes SQL it does not execute. */
const sql = raw
  .split("\n")
  .map((line) => {
    const at = line.indexOf("--");
    return at === -1 ? line : line.slice(0, at);
  })
  .join("\n");

describe("the CHECK", () => {
  it("drops and re-adds the constraint under the name taxonomy v2 gave it", () => {
    // 🔒 **THE NAME IS READ OUT OF THE EARLIER MIGRATION, NOT GUESSED.** A
    // typo'd name would leave the OLD three-value constraint in place and ADD a
    // second one beside it — `pro` still refused, with two constraints on the
    // column and nothing saying which one refused it.
    expect(read(TAXONOMY_V2)).toContain(
      "ADD CONSTRAINT workspace_billing_plan_check"
    );
    expect(sql).toContain(
      "DROP CONSTRAINT IF EXISTS workspace_billing_plan_check"
    );
    expect(sql).toContain(
      "ADD CONSTRAINT workspace_billing_plan_check"
    );
  });

  it("admits exactly free, solo, team and pro", () => {
    expect(sql).toContain("CHECK (plan IN ('free', 'solo', 'team', 'pro'))");
  });

  it("🔒 the CHECK's value set EQUALS the TypeScript taxonomy", () => {
    // ⚠ THE DRIFT THIS FILE EXISTS TO CATCH, IN BOTH DIRECTIONS. A value in the
    // union the CHECK lacks is a webhook `23514` that retries forever; a value
    // in the CHECK the union lacks is a row every reader casts into a type that
    // cannot hold it and then takes the default branch for.
    const inCheck = [
      ...sql.matchAll(/CHECK \(plan IN \(([^)]*)\)\)/g),
    ][0]?.[1]
      ?.split(",")
      .map((v) => v.trim().replace(/'/g, ""));
    expect(inCheck?.slice().sort()).toEqual(["free", "pro", "solo", "team"]);

    // The two unions, spelled out — `satisfies` makes each an exhaustiveness
    // error rather than a stale list if `PlanId` grows.
    const planIds = {
      free: 1,
      solo: 1,
      team: 1,
      pro: 1,
    } satisfies Record<PlanId, number>;
    const rowPlans = {
      free: 1,
      solo: 1,
      team: 1,
      pro: 1,
    } satisfies Record<WorkspaceBillingPlan, number>;
    expect(Object.keys(planIds).sort()).toEqual(inCheck?.slice().sort());
    expect(Object.keys(rowPlans).sort()).toEqual(inCheck?.slice().sort());
  });

  it("changes NOTHING else — no data migration, no rename, no new column", () => {
    // 🔒 `pro` IS NOT `solo` RENAMED AND NOT THE OLD PER-SEAT `pro` RESTORED.
    // Taxonomy v2 renamed those rows to `team` and dropped the value; this file
    // re-admits the STRING for a different plan, so there is nothing to
    // backfill and an UPDATE here would relabel live rows.
    expect(sql).not.toMatch(/\bUPDATE\b/);
    expect(sql).not.toMatch(/\bADD COLUMN\b/);
    expect(sql).not.toMatch(/\bCREATE TABLE\b/);
    expect(sql).not.toMatch(/\bDROP TABLE\b/);
  });

  it("documents the column so the catalog says what each value means", () => {
    expect(sql).toContain("COMMENT ON COLUMN public.workspace_billing.plan");
    for (const claim of ["personal", "RETIRED FROM SALE", "8.99"]) {
      expect(sql).toContain(claim);
    }
  });
});

describe("the header", () => {
  const prose = raw.replace(/\n--\s*/g, " ");

  it("says it is WRITTEN AND NOT APPLIED", () => {
    expect(prose).toContain("WRITTEN, NOT APPLIED");
  });

  it("tells the reader to re-derive deploy state BY NAME, never by prefix", () => {
    expect(prose).toContain("supabase migration list");
    expect(prose).toContain("JOIN ON THE\n-- NAME".replace(/\n-- /, " "));
  });

  it("names its apply order relative to the wallet migration", () => {
    expect(prose).toContain("20260930120000_credit_wallets.sql");
  });

  it("🔒 carries a rollback AND says when it is unsafe", () => {
    // ⚠ **THE ROLLBACK IS SAFE ONLY WHILE NO `pro` ROW EXISTS**, because ADD
    // CONSTRAINT validates the whole table. A header that printed the three
    // statements without that sentence would read as "reversible", and the
    // person reading it at 3am would discover otherwise from a 23514.
    expect(prose).toContain("CHECK (plan IN ('free', 'solo', 'team'))");
    expect(prose).toContain("SAFE ONLY WHILE NO `pro` ROW EXISTS");
    expect(prose).toContain(
      "SELECT count(*) FROM public.workspace_billing WHERE plan = 'pro'"
    );
  });

  it("quotes the ruling it implements", () => {
    expect(prose).toContain("Personal free is 500, seat free");
  });
});

describe("ordering", () => {
  it("has a unique version and sorts after every pending file", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => f.startsWith("20260930130000"))).toEqual([NAME]);
    expect(files.filter((f) => f.slice(0, 14) > "20260930130000")).toEqual([]);
    // ⚠ AND AFTER THE MIGRATION THAT CREATED THE CONSTRAINT IT REPLACES. Landing
    // first would drop a constraint that does not exist yet (harmless) and then
    // be overwritten by v2's three-value one (not harmless).
    expect(TAXONOMY_V2.slice(0, 14) < "20260930130000").toBe(true);
    expect(files).toContain(TAXONOMY_V2);
  });
});
