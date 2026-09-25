/**
 * MCP credits — per-call cost, per-wallet allowance, period rules. One copy of
 * each number lives here; prices live in `./prices.ts`.
 *
 * Must stay pure/framework-free (no `server-only`, Supabase or React): the
 * server route, status service and client entitlements mirror all import it.
 * Counts one MCP tool call (`packages/mcp-server/src/registrar.ts ›
 * createToolRegistrars`), not one HTTP request — a tool call makes 0..N loopback
 * requests, so `mcp_tool_calls` is not the counter.
 *
 * 2026-09-07: two wallets, both per person — personal (home space) and seat
 * (per standard-workspace member, fixed and non-pooled). Supersedes the pooled
 * per-workspace `MONTHLY_MCP_CREDITS` / `monthlyCreditsForPlan`, deleted rather
 * than aliased so a pooled question cannot get a per-seat answer.
 * 2026-09-08: both wallets gained a paid tier, so `PERSONAL_MONTHLY_CREDITS`
 * became a map — a shape change every importer must resolve.
 */

import type { PlanId } from "./plans";

/** Cost of one MCP tool call. Per-tool weighting would be a map keyed by tool
 *  name here, not a second constant elsewhere. */
export const CREDITS_PER_MCP_CALL = 1;

/** Which counter a burn moves. `personal` = one per user, spent by everything
 *  in their home space. `seat` = one per (standard workspace, member). */
export type WalletKind = "personal" | "seat";

/**
 * Per-member monthly allowance inside a standard workspace, by entitled plan
 * (2026-09-07: free 100 each, paid 5,000 each at $8 per seat).
 *
 * Per member, not pooled: a ten-person Team holds ten separate 5,000s, not
 * 50,000 shared, which is why the counter is keyed on the member
 * (`20260930120000` §2).
 * `solo` is legacy-paid and takes the paid figure — retired from sale, but live
 * rows keep working until they cancel or switch.
 */
export const SEAT_MONTHLY_CREDITS: Record<PlanId, number> = {
  free: 100,
  solo: 5_000,
  team: 5_000,
  // `pro` never applies to a seat; the key exists for the `Record` type alone
  // (2026-09-08). `pro` is sold only on a `kind='home'` container, whose
  // burns go to the personal wallet via `PERSONAL_MONTHLY_CREDITS`. Widening to
  // `Partial<Record<…>>` would delete the compile error that forces the next
  // plan id to declare its seat allowance here.
  pro: 5_000,
};

/**
 * Monthly allowance on a user's personal wallet (their home space), by the
 * home space's entitled plan. Two tiers since 2026-09-08, superseding
 * spec assumption A5's bare `500`.
 *
 * Keyed `"free" | "pro"` rather than `PlanId` on purpose: a home space
 * can only ever be entitled to those two, so the narrow map makes "what does a
 * `team` personal wallet get" unaskable. `personalCreditsForPlan` narrows a
 * verdict onto it.
 * 500 ≠ `SEAT_MONTHLY_CREDITS.free` (100) deliberately — a free personal wallet
 * is a whole home space, not one seat among many.
 */
export const PERSONAL_MONTHLY_CREDITS: Record<"free" | "pro", number> = {
  free: 500,
  pro: 5_000,
};

/**
 * Personal allowance for an entitlement-resolved verdict — never raw
 * `workspace_billing.plan`. Anything but `pro` is free, `team`/`solo` included:
 * those cannot be a personal verdict, so fail to the small number rather than
 * handing a free home space the paid allowance on a bad row.
 */
export function personalCreditsForPlan(verdict: PlanId): number {
  return verdict === "pro"
    ? PERSONAL_MONTHLY_CREDITS.pro
    : PERSONAL_MONTHLY_CREDITS.free;
}

/**
 * Per-member allowance for an entitlement-resolved plan — never raw
 * `workspace_billing.plan` (a degraded solo gets free credits).
 */
export function seatCreditsForPlan(plan: PlanId): number {
  return SEAT_MONTHLY_CREDITS[plan] ?? SEAT_MONTHLY_CREDITS.free;
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

/** UTC calendar month containing `now` — the shared fallback for both period
 *  rules, so they cannot disagree about where a month starts. */
function calendarMonth(now: Date): CreditPeriod {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    periodStart: new Date(Date.UTC(year, month, 1)).toISOString(),
    periodEnd: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}

/**
 * The personal wallet's window when there is nothing to anchor to: the UTC
 * calendar month. The counter self-rolls on the 1st because the key it stamps
 * advances; no reset cron.
 *
 * Since 2026-09-08 this is only part of the personal rule — a `pro` container
 * has a subscription, so `server/credits-service.ts` resolves through
 * `resolveCreditPeriod(anchor, verdict)`. This survives as that function's
 * free / no-row arm and as the window `unmetered()` stamps on zeroes.
 */
export function personalCreditPeriod(now: Date = new Date()): CreditPeriod {
  return calendarMonth(now);
}

/**
 * Which period a burn made `now` is charged to — either wallet since 2026-09-08,
 * so the two cannot disagree about where a month starts.
 *
 * `entitledPlan` = entitlement verdict (`server/entitlements.ts ›
 * entitledPlanFor`), never raw `workspace_billing.plan`, and read FIRST:
 * a free verdict ignores the anchor because a canceled row keeps a
 * future-ending anchor, which would charge to the period key the paid plan
 * already spent (4,000 used vs a fresh 100 limit = locked out of MCP); this
 * also covers degraded solo. A paid verdict with both period columns stamped
 * and the end still future uses the subscription anchor, so credits roll on the
 * billing date. Otherwise the UTC calendar month, which always advances — the
 * counter self-rolls on next consume, no reset cron.
 *
 * Enforcement and meter must pass the SAME verdict (`credits-service.ts ›
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
  return calendarMonth(now);
}
