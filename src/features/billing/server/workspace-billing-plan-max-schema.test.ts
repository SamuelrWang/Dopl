/**
 * Invariant suite — `20261121170000_workspace_billing_plan_max.sql` read as a
 * contract. It is the only schema the personal Max tier needs, and it is now the
 * LAST statement of `workspace_billing_plan_check`, so it owns the equality with
 * `PlanId`: a value the CHECK lacks is a `23514` inside the Stripe webhook that
 * Stripe retries forever while the customer is already charged.
 *
 * Deploy state is a measurement (`supabase migration list`, joined on the NAME —
 * INVARIANTS §12); this suite reads the file and says nothing about what is
 * applied. Comments are stripped before the SQL assertions because the header
 * quotes its own rollback SQL.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PlanId } from "../plans";
import type { WorkspaceBillingPlan } from "./workspace-billing";

const MIGRATIONS = resolve(process.cwd(), "supabase", "migrations");
const NAME = "20261121170000_workspace_billing_plan_max.sql";
const PRO = "20260930130000_workspace_billing_plan_pro.sql";
const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), "utf8");

const raw = read(NAME);
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
  it("drops and re-adds the constraint under the SAME name", () => {
    expect(read(PRO)).toContain("ADD CONSTRAINT workspace_billing_plan_check");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS workspace_billing_plan_check");
    expect(sql).toContain("ADD CONSTRAINT workspace_billing_plan_check");
  });

  it("🔒 the CHECK's value set EQUALS the TypeScript taxonomy", () => {
    const inCheck = [...sql.matchAll(/CHECK \(plan IN \(([^)]*)\)\)/g)][0]?.[1]
      ?.split(",")
      .map((v) => v.trim().replace(/'/g, ""));
    expect(inCheck?.slice().sort()).toEqual(["free", "max", "pro", "solo", "team"]);
    // `satisfies` makes each an exhaustiveness error if `PlanId` grows.
    const planIds = {
      free: 1,
      solo: 1,
      team: 1,
      pro: 1,
      max: 1,
    } satisfies Record<PlanId, number>;
    const rowPlans = {
      free: 1,
      solo: 1,
      team: 1,
      pro: 1,
      max: 1,
    } satisfies Record<WorkspaceBillingPlan, number>;
    expect(Object.keys(planIds).sort()).toEqual(inCheck?.slice().sort());
    expect(Object.keys(rowPlans).sort()).toEqual(inCheck?.slice().sort());
  });

  it("changes NOTHING else — three statements, no data, no column", () => {
    expect(sql.split(";").filter((part) => part.trim()).length).toBe(3);
    expect(sql).not.toMatch(/\bUPDATE\b/);
    expect(sql).not.toMatch(/\bADD COLUMN\b/);
    expect(sql).not.toMatch(/\bCREATE TABLE\b/);
    expect(sql).not.toMatch(/\bDROP TABLE\b/);
  });

  it("documents the column with the container kind as it is spelled today", () => {
    expect(sql).toContain("COMMENT ON COLUMN public.workspace_billing.plan");
    expect(sql).toContain("kind=''home''");
  });
});

describe("the header", () => {
  const prose = raw.replace(/\n--\s*/g, " ");

  it("says it is WRITTEN AND NOT APPLIED, and how to measure that", () => {
    expect(prose).toContain("WRITTEN, NOT APPLIED");
    expect(prose).toContain("supabase migration list");
  });

  it("🔒 carries a rollback AND says when it is unsafe", () => {
    expect(prose).toContain("CHECK (plan IN ('free', 'solo', 'team', 'pro'))");
    expect(prose).toContain("SAFE ONLY WHILE NO `max` ROW EXISTS");
    expect(prose).toContain(
      "SELECT count(*) FROM public.workspace_billing WHERE plan = 'max'"
    );
  });
});

describe("ordering", () => {
  it("has a unique version, sorts after the Pro widening, and nothing later re-states it", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => f.startsWith("20261121170000"))).toEqual([NAME]);
    expect(PRO.slice(0, 14) < NAME.slice(0, 14)).toBe(true);
    const later = files.filter((f) => f.slice(0, 14) > NAME.slice(0, 14));
    for (const name of later) {
      const laterSql = strip(read(name)).replace(/COMMENT ON[\s\S]*?';/g, "");
      expect(laterSql, `${name} re-states the plan CHECK`).not.toMatch(
        /workspace_billing[\s\S]{0,200}?plan/
      );
    }
  });
});
