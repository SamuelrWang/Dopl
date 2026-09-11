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
 *
 * 🔒 **AND BOTH WALLETS HAVE A PAID TIER SINCE 2026-09-08** (Samuel: "Personal
 * free is 500, seat free is 100, pro individual is 5,000, and team individual
 * is also 5,000"). `PERSONAL_MONTHLY_CREDITS` stopped being one number and
 * became a two-key map — the SUPERSEDED line said "one tier this wave", and it
 * is dated where it stood rather than deleted, because the constant's SHAPE
 * changed and every importer that read it as a number is a compile error until
 * it picks a key. ⚠ PRICES ARE NOT HERE: they live in `./prices.ts`, which is
 * the other half of the same rule (one number, one place).
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
  // ⚠ **`pro` NEVER APPLIES TO A SEAT, AND THE KEY IS HERE FOR THE `Record`
  // TYPE ALONE** (2026-09-08). `pro` is sold only on a `kind='personal'`
  // container, which has exactly one member and no seats at all — a burn there
  // is charged to the PERSONAL wallet by `PERSONAL_MONTHLY_CREDITS`, never
  // through this map. Widening the map to `Partial<Record<…>>` instead would
  // delete the compile error that makes the NEXT plan id declare its seat
  // allowance here, which is the only thing this exhaustive type buys.
  pro: 5_000,
};

/**
 * Monthly allowance on a user's PERSONAL wallet — their home space — by the
 * personal container's ENTITLED plan.
 *
 * 🔒 **TWO TIERS SINCE 2026-09-08** (Samuel, verbatim: "The free tier gives you
 * 500 credits a month. 899 gives you, let's say, 5,000 credits a month …
 * Personal free is 500 … pro individual is 5,000"). ⚠ **THE SUPERSEDED LINE
 * SAID "ONE TIER THIS WAVE" AND WAS A BARE `500`** (2026-09-07, spec
 * assumption A5, taken because Samuel had given workspace figures and no
 * personal one). A5 is superseded, not wrong: the follow-up ruling it was
 * waiting for arrived, and this is the map it predicted.
 *
 * ⚠ **KEYED `"free" | "pro"`, NOT `PlanId`, AND THAT IS THE CONTRACT.** A
 * personal container can only ever be entitled to those two — `team` is sold
 * on a standard workspace and `solo` is a retired standard plan — so a map over
 * the whole taxonomy would invite a caller to ask what a `team` personal wallet
 * gets, which is not a question. `personalCreditsForPlan` is what narrows a
 * verdict onto it.
 *
 * ⚠ **500 IS ALSO NOT `SEAT_MONTHLY_CREDITS.free` (100), AND THE GAP IS
 * DELIBERATE.** A free seat is one of many inside somebody's paid-or-free
 * workspace; a free personal wallet is a person's whole home space, and cutting
 * it to the seat figure would take 80% off every existing user's allowance
 * overnight.
 */
export const PERSONAL_MONTHLY_CREDITS: Record<"free" | "pro", number> = {
  free: 500,
  pro: 5_000,
};

/**
 * PERSONAL allowance for an ENTITLEMENT-RESOLVED verdict — never raw
 * `workspace_billing.plan`.
 *
 * ⚠ **ANYTHING THAT IS NOT `pro` IS FREE, INCLUDING `team` AND `solo`.** Those
 * two cannot be the verdict on a personal container (nothing sells them there),
 * so this is the answer to a state the product cannot produce — and the answer
 * has to be the SMALL number: reading a stray `team` row as 5,000 would hand a
 * free home space the paid allowance on the strength of a bad row.
 */
export function personalCreditsForPlan(verdict: PlanId): number {
  return verdict === "pro"
    ? PERSONAL_MONTHLY_CREDITS.pro
    : PERSONAL_MONTHLY_CREDITS.free;
}

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
 * The PERSONAL wallet's window WHEN THERE IS NOTHING TO ANCHOR TO: the UTC
 * calendar month. The counter self-rolls on the 1st because the key it stamps
 * advances; no reset cron, same as every other counter here.
 *
 * ⚠ **THIS IS NO LONGER THE WHOLE PERSONAL RULE (2026-09-08).** It said "always
 * the UTC calendar month", and that was true while the personal wallet had one
 * tier. A `pro` container has a Stripe subscription and therefore a billing
 * date, so `server/credits-service.ts` resolves the personal window through
 * `resolveCreditPeriod(anchor, verdict)` — the SAME function the seat wallet
 * uses, exactly as the superseded note predicted ("it does NOT grow a second
 * copy of it"). This function survives as that function's FREE / no-row arm and
 * as the window `unmetered()` stamps on zeroes it never measured.
 */
export function personalCreditPeriod(now: Date = new Date()): CreditPeriod {
  return calendarMonth(now);
}

/**
 * Which period a burn made `now` is charged to — EITHER WALLET since
 * 2026-09-08 (it was seat-only while the personal wallet had no subscription to
 * anchor to; a `pro` container has one, and one window rule is what keeps the
 * two wallets from disagreeing about where a month starts).
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
