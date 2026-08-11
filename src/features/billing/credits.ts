/**
 * MCP CREDITS — THE ONE RETUNE SPOT.
 *
 * Every number the credit meter depends on lives in THIS FILE and nowhere
 * else: the per-call cost, the per-plan monthly allowance, and the rule that
 * decides which billing period a call is charged to. Changing what a plan is
 * worth is a one-line edit here — no migration, no route change, no UI change.
 * If you find a second copy of any of these numbers, that copy is the bug.
 *
 * Pure and framework-free ON PURPOSE: the server route, the status service and
 * the client-side entitlements mirror all read it, so it may not import
 * `server-only`, Supabase, or React. It is unit-tested in `credits.test.ts`.
 *
 * WHAT IS COUNTED: one MCP TOOL CALL (`packages/mcp-server/src/registrar.ts ›
 * createToolRegistrars`), not one HTTP request. A single tool call makes 0..N
 * loopback requests, so `mcp_tool_calls` is NOT the counter — see
 * `docs/ENGINEERING.md` (2026-08-11, MCP credits).
 */

import type { PlanId } from "./plans";

/**
 * What one MCP tool call costs. A flat 1 today; per-tool weighting (a
 * `dopl_search` fan-out costing more than a `dopl_kb` read) would be a map
 * keyed by tool name RIGHT HERE, not a second constant somewhere else.
 */
export const CREDITS_PER_MCP_CALL = 1;

/**
 * Monthly MCP credit allowance per plan, PER WORKSPACE.
 *
 * Team is FLAT — 25,000 for the whole workspace, NOT per seat. That is a
 * deliberate pricing choice, not an oversight: seats already bill per member,
 * and a per-seat credit pool would make an agent's budget depend on how many
 * humans happen to be in the room. Tunable — this is the retune spot.
 */
export const MONTHLY_MCP_CREDITS: Record<PlanId, number> = {
  free: 500,
  solo: 10_000,
  team: 25_000,
};

/** The monthly allowance for an ENTITLEMENT-RESOLVED plan (never the raw
 *  `workspace_billing.plan` — a degraded solo gets free credits). */
export function monthlyCreditsForPlan(plan: PlanId): number {
  return MONTHLY_MCP_CREDITS[plan] ?? MONTHLY_MCP_CREDITS.free;
}

/** A resolved billing period, both bounds as ISO-8601 UTC instants. */
export interface CreditPeriod {
  /** Inclusive start — also the credit ledger's partition key. */
  periodStart: string;
  /** Exclusive end. Rendered, never used as a key. */
  periodEnd: string;
}

/** The two `workspace_billing` columns the period resolver reads. */
export interface CreditPeriodAnchor {
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Which period a call made `now` is charged to.
 *
 * `entitledPlan` is THE ENTITLEMENT VERDICT (`server/entitlements.ts ›
 * entitledPlanFor`), never the raw `workspace_billing.plan`, and it is the
 * FIRST thing this rule reads:
 *
 * A FREE VERDICT IGNORES THE ANCHOR ENTIRELY — a free workspace's window is
 * always the UTC calendar month. This is not a tidiness rule, it is the
 * self-heal for a cancellation: cancel mid-period and the row keeps a period
 * anchor whose end is still in the FUTURE, so the anchor branch would charge
 * the next call to the SAME period key the paid plan had been spending
 * against — 8,000 used against a fresh 500 limit, i.e. the workspace is locked
 * out of MCP until the anchor expires. Reading the verdict first heals that
 * without waiting for any webhook, and covers the degraded-solo case
 * (`paidEntitlement`: solo with a second member) for free.
 *
 * SUBSCRIPTION ANCHOR for a PAID verdict with BOTH period columns stamped by
 * the Stripe webhook AND an end still in the future — a paid workspace's
 * credits should roll on its own billing date, not on the 1st.
 *
 * UTC CALENDAR MONTH otherwise. Free workspaces usually have no
 * `workspace_billing` row at all, and a lapsed sub's stale period would pin a
 * canceled workspace to a window that never rolls. The calendar month always
 * advances, so the counter SELF-ROLLS on the next consume — no reset cron.
 *
 * ENFORCEMENT AND THE METER MUST PASS THE SAME VERDICT (`credits-service.ts ›
 * consumeMcpCredits` and `summarizeCredits`). A settings meter reading one
 * window while the gate charges another shows a used/limit pair that does not
 * explain the refusal the operator just saw.
 *
 * Pure: `now` is injected so the fallback is testable.
 */
export function resolveCreditPeriod(
  anchor: CreditPeriodAnchor,
  entitledPlan: PlanId,
  now: Date = new Date()
): CreditPeriod {
  if (entitledPlan !== "free") {
    const start = parseInstant(anchor.currentPeriodStart);
    const end = parseInstant(anchor.currentPeriodEnd);
    if (start && end && end.getTime() > now.getTime() && end > start) {
      return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
    }
  }
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    periodStart: new Date(Date.UTC(year, month, 1)).toISOString(),
    periodEnd: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}
