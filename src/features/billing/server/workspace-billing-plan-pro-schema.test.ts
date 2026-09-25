/**
 * Invariant suite — `20260930130000_workspace_billing_plan_pro.sql` read as a
 * contract. It is the only schema the personal Pro tier needs. If the CHECK and
 * the TypeScript union disagree, the failure is a `23514` raised inside the Stripe
 * webhook, which Stripe retries forever against a database that will never accept
 * the row while the customer is already charged.
 *
 * Deploy state is a measurement (`supabase migration list`, joined on the NAME —
 * INVARIANTS §12, F-304); this suite reads the file and says nothing about what is
 * applied. Comments are stripped before the SQL assertions because the migration
 * header quotes its own rollback SQL.
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
const strip = (text: string) =>
  text
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
const sql = strip(raw);

describe("the CHECK", () => {
  it("drops and re-adds the constraint under the name taxonomy v2 gave it", () => {
    // The name is read out of the earlier migration, not guessed: a typo would
    // leave the old three-value constraint in place and add a second one beside it.
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
    // The drift this file exists to catch, in both directions: a value the CHECK
    // lacks is a webhook `23514` that retries forever; a value the union lacks is a
    // row every reader casts into a type that cannot hold it.
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
    // `pro` is not `solo` renamed nor the old per-seat `pro` restored: this file
    // re-admits the string for a different plan, so there is nothing to backfill
    // and an UPDATE here would relabel live rows.
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
    // The rollback is safe only while no `pro` row exists, because ADD CONSTRAINT
    // validates the whole table — so the header must say so, not just print it.
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
  it("has a unique version, and no later file re-states the plan CHECK", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => f.startsWith("20260930130000"))).toEqual([NAME]);
    // The rule is that nothing following may re-state the constraint this file
    // widens — checked over every later file, not over an allow-list of names
    // (and not by asserting this is the newest migration, which only holds while
    // the branch is alone).
    const later = files.filter((f) => f.slice(0, 14) > "20260930130000");
    for (const name of later) {
      // A COMMENT ON the column documents it and re-states no CHECK.
      const laterSql = strip(read(name)).replace(/COMMENT ON[\s\S]*?';/g, "");
      expect(laterSql, `${name} re-states the plan CHECK`).not.toMatch(
        /workspace_billing[\s\S]{0,200}?plan/
      );
    }
    // And after the migration that created the constraint it replaces: landing
    // first would be overwritten by v2's three-value constraint.
    expect(TAXONOMY_V2.slice(0, 14) < "20260930130000").toBe(true);
    expect(files).toContain(TAXONOMY_V2);
  });
});
