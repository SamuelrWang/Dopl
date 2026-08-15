/**
 * MCP CREDITS — the ONE retune spot. Per-call cost, per-plan allowance, period
 * rule all live here; a second copy of any of these numbers is a bug.
 *
 * ⚠ Must stay pure/framework-free — server route, status service and the client
 * entitlements mirror all import it, so no `server-only`, Supabase or React.
 *
 * Counts one MCP TOOL CALL (`packages/mcp-server/src/registrar.ts ›
 * createToolRegistrars`), NOT one HTTP request: a tool call makes 0..N loopback
 * requests, so `mcp_tool_calls` is not the counter.
 */

import type { PlanId } from "./plans";

/** Cost of one MCP tool call. Per-tool weighting = a map keyed by tool name
 *  HERE, not a second constant elsewhere. */
export const CREDITS_PER_MCP_CALL = 1;

/**
 * Monthly MCP credit allowance per plan, PER WORKSPACE.
 * Team is FLAT (25,000 workspace-wide, NOT per seat) — deliberate: seats
 * already bill per member. Tunable.
 */
export const MONTHLY_MCP_CREDITS: Record<PlanId, number> = {
  free: 500,
  solo: 10_000,
  team: 25_000,
};

/** Allowance for an ENTITLEMENT-RESOLVED plan — never raw
 *  `workspace_billing.plan` (degraded solo gets free credits). */
export function monthlyCreditsForPlan(plan: PlanId): number {
  return MONTHLY_MCP_CREDITS[plan] ?? MONTHLY_MCP_CREDITS.free;
}

/** Resolved billing period; both bounds ISO-8601 UTC. */
export interface CreditPeriod {
  /** Inclusive start — also the credit ledger's partition key. */
  periodStart: string;
  /** Exclusive end. Rendered, never a key. */
  periodEnd: string;
}

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
 * `entitledPlan` = entitlement VERDICT (`server/entitlements.ts ›
 * entitledPlanFor`), never raw `workspace_billing.plan`, and read FIRST:
 *
 * ⚠ FREE verdict ignores the anchor entirely → always UTC calendar month.
 * Self-heal for cancellation: a canceled row keeps a future-ending anchor, so
 * the anchor branch would charge to the period key the paid plan already spent
 * (8,000 used vs a fresh 500 limit = locked out of MCP). Also covers degraded
 * solo (`paidEntitlement`).
 *
 * PAID verdict + both period columns stamped + end still future → subscription
 * anchor (credits roll on the billing date, not the 1st).
 *
 * Otherwise UTC calendar month: always advances, so the counter SELF-ROLLS on
 * next consume — no reset cron.
 *
 * ⚠ Enforcement and meter must pass the SAME verdict (`credits-service.ts ›
 * consumeMcpCredits` and `summarizeCredits`), else the meter shows a used/limit
 * pair that does not explain the refusal.
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
