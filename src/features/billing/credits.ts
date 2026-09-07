/**
 * MCP CREDITS — the ONE retune spot. Per-call cost, per-WALLET allowance, and
 * the period rules all live here; a second copy of any of these numbers is a
 * bug.
 *
 * ⚠ Must stay pure/framework-free — server route, status service and the client
 * entitlements mirror all import it, so no `server-only`, Supabase or React.
 *
 * Counts one MCP TOOL CALL (`packages/mcp-server/src/registrar.ts ›
 * createToolRegistrars`), NOT one HTTP request: a tool call makes 0..N loopback
 * requests, so `mcp_tool_calls` is not the counter.
 *
 * 🔒 **TWO WALLETS SINCE 2026-09-07 (Samuel's ruling), AND THE ALLOWANCE IS
 * PER PERSON IN BOTH.** The home space charges a user's own PERSONAL wallet;
 * a standard workspace charges the caller's SEAT, at a FIXED, NON-POOLED
 * per-member figure — "each user gets a fixed amount", so `SEAT_MONTHLY_CREDITS`
 * is multiplied by nobody. ⚠ **THIS SUPERSEDES `MONTHLY_MCP_CREDITS`**, which
 * was one pooled allowance per WORKSPACE (free 500 / solo 10,000 / team 25,000
 * workspace-wide). That map and `monthlyCreditsForPlan` are DELETED, not
 * aliased: an alias would let a caller keep asking the pooled question and get
 * a per-seat answer.
 */

import type { PlanId } from "./plans";

/** Cost of one MCP tool call. Per-tool weighting = a map keyed by tool name
 *  HERE, not a second constant elsewhere. */
export const CREDITS_PER_MCP_CALL = 1;

/** Which counter a burn moves. `personal` = one per user, spent by everything
 *  in that user's home space. `seat` = one per (standard workspace, member). */
export type WalletKind = "personal" | "seat";

/**
 * Per-MEMBER monthly allowance inside a standard workspace, by ENTITLED plan
 * (Samuel, 2026-09-07: Free 100 each, paid 5,000 each at $8 per seat).
 *
 * ⚠ **PER MEMBER, NOT PER WORKSPACE, AND NOT POOLED.** A ten-person Team
 * workspace does not hold 50,000 shared credits — it holds ten separate 5,000s,
 * and a member who exhausts theirs cannot borrow from a colleague who did not.
 * That is the ruling in as many words ("I don't think it should be pooled"),
 * and it is why the counter is keyed on the member (`20260930120000` §2).
 *
 * ⚠ `solo` is LEGACY-PAID and takes the paid figure. It is retired from sale
 * (no Solo card, no `solo` checkout), but live rows keep working until they
 * cancel or switch to Team, and a legacy payer's members are entitled to what
 * paid members get.
 */
export const SEAT_MONTHLY_CREDITS: Record<PlanId, number> = {
  free: 100,
  solo: 5_000,
  team: 5_000,
};

/**
 * Monthly allowance on a user's PERSONAL wallet — their home space.
 *
 * ⚠ **ONE TIER THIS WAVE, AND THE FIGURE IS THE STATUS-QUO FREE ALLOWANCE**
 * (2026-09-07). Samuel's ruling gave workspace numbers and no personal one, so
 * this holds the 500 that free workspaces already had rather than inventing a
 * price or cutting a live user's allowance overnight. A personal PAID tier is a
 * follow-up ruling, and when it arrives this becomes a map exactly like
 * `SEAT_MONTHLY_CREDITS` — flagged to Samuel, not decided here.
 */
export const PERSONAL_MONTHLY_CREDITS = 500;

/**
 * Per-member allowance for an ENTITLEMENT-RESOLVED plan — never raw
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

/** The UTC calendar month containing `now`. The one shape both period rules
 *  fall back to, so they cannot disagree about where a month starts. */
function calendarMonth(now: Date): CreditPeriod {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    periodStart: new Date(Date.UTC(year, month, 1)).toISOString(),
    periodEnd: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}

/**
 * The PERSONAL wallet's window: always the UTC calendar month.
 *
 * ⚠ **NO ANCHOR, AND THERE IS NOTHING TO ANCHOR TO.** A personal wallet has no
 * subscription and therefore no billing date — it is one tier
 * (`PERSONAL_MONTHLY_CREDITS`). The counter self-rolls on the 1st because the
 * key it stamps advances; no reset cron, same as every other counter here.
 * ⚠ When a personal PAID tier lands, this grows the anchor branch
 * `resolveCreditPeriod` already has — it does NOT grow a second copy of it.
 */
export function personalCreditPeriod(now: Date = new Date()): CreditPeriod {
  return calendarMonth(now);
}

/**
 * Which period a SEAT burn made `now` is charged to.
 *
 * `entitledPlan` = entitlement VERDICT (`server/entitlements.ts ›
 * entitledPlanFor`), never raw `workspace_billing.plan`, and read FIRST:
 *
 * ⚠ FREE verdict ignores the anchor entirely → always UTC calendar month.
 * Self-heal for cancellation: a canceled row keeps a future-ending anchor, so
 * the anchor branch would charge to the period key the paid plan already spent
 * (4,000 used vs a fresh 100 limit = locked out of MCP). Also covers degraded
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
  return calendarMonth(now);
}
