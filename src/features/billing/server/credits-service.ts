import "server-only";
import { findActiveOwnerUserId } from "@/features/workspaces/server/repository";
import {
  isStandardWorkspace,
  type WorkspaceKind,
} from "@/features/workspaces/types";
import {
  CREDITS_PER_MCP_CALL,
  PERSONAL_MONTHLY_CREDITS,
  personalCreditPeriod,
  resolveCreditPeriod,
  seatCreditsForPlan,
  type CreditPeriod,
  type WalletKind,
} from "../credits";
import type { PlanId } from "../plans";
import {
  consumeMemberCredits,
  consumeUserCredits,
  getMemberCreditsUsed,
  getUserCreditsUsed,
} from "./credit-wallets";
import { recordCreditUsageEvent } from "./credit-ledger";
import { entitledPlanFor, upgradeUrl } from "./entitlements";
import {
  countActiveMembers,
  getWorkspaceBilling,
  type WorkspaceBillingRow,
} from "./workspace-billing";

/**
 * MCP credits — business logic between route and repository. NUMBERS live in
 * `../credits.ts` (the one retune spot); this owns only the two questions that
 * need the database: "may this call proceed" and "how much is left".
 *
 * 🔒 **TWO WALLETS, AND THE ADDRESSED CONTAINER'S KIND PICKS ONE (Samuel,
 * 2026-09-07).** A standard workspace charges the CALLER'S OWN SEAT at the
 * workspace's entitled per-member allowance; a home-space container charges the
 * container OWNER'S PERSONAL wallet. Every path implements the same table:
 *
 *   | addressed kind | wallet     | payer            | limit                    | period                  |
 *   |----------------|------------|------------------|--------------------------|-------------------------|
 *   | `standard`     | `seat`     | the caller       | `seatCreditsForPlan(…)`  | `resolveCreditPeriod`   |
 *   | `personal`     | `personal` | the caller (= owner) | `PERSONAL_MONTHLY_CREDITS` | `personalCreditPeriod` |
 *   | `link`         | `personal` | the container OWNER  | `PERSONAL_MONTHLY_CREDITS` | `personalCreditPeriod` |
 *   | no active owner| —          | —                | unmetered, logged        | —                       |
 *
 * ⚠ The plan is the ENTITLEMENT VERDICT, never `workspace_billing.plan` — a
 * solo sub that grew a second member is degraded to free by
 * `entitlements.ts › paidEntitlement`, and the raw column would hand every one
 * of its members the paid allowance.
 */

/** Who is burning the credit. ⚠ REQUIRED since 2026-09-07: the seat wallet is
 *  keyed on the caller and the personal wallet on the container's owner, so
 *  there is no wallet to move without knowing who called. */
export interface CreditCaller {
  userId: string;
  /** The TARGET workspace's kind. Absent = standard (column not yet applied). */
  workspaceKind?: WorkspaceKind;
}

/**
 * Why a burn found no counter to move. Never silent — `consumeMcpCredits` logs
 * it.
 *
 * ⚠ **ONE REASON LEFT SINCE 2026-09-07.** `container-owner-has-no-billing-workspace`
 * and `container-owner-has-ambiguous-billing-workspace` are DELETED with the
 * lookup that produced them: a home burn no longer needs the owner to have a
 * standard workspace at all, because it lands on the owner's PERSONAL wallet
 * and every user has exactly one of those (`20260920120000_workspace_kind_personal.sql`).
 * There is nothing left to be missing or ambiguous.
 */
export type UnmeteredReason = "container-has-no-active-owner";

/**
 * Which counter a burn moves, and whose allowance that is.
 *
 * ⚠ `workspaceId` IS ALWAYS THE ADDRESSED CONTAINER — on both metered arms and
 * on the unmetered one. It is no longer "the workspace that pays": on the seat
 * arm the workspace is half the counter key, and on the personal arm it is only
 * the origin the ledger records. The PAYER is always `payerUserId`.
 */
export type BillingTarget =
  | { wallet: "seat"; workspaceId: string; payerUserId: string }
  | { wallet: "personal"; workspaceId: string; payerUserId: string }
  | {
      wallet: null;
      workspaceId: string;
      payerUserId: null;
      reason: UnmeteredReason;
    };

/**
 * Which wallet a charge addressed at `workspaceId` lands on, and whose.
 *
 * 🔒 **A HOME-SPACE BURN IS CHARGED TO THE CONTAINER'S OWNER, WHOEVER MADE THE
 * CALL** (Samuel, 2026-08-26: "charge MCP calls from a guest to the user"). That
 * ruling is unchanged; only the wallet moved. A `link` container is a
 * relationship and a `personal` container is a shelf; neither is a tenant and
 * neither carries a plan. The person who minted the container invited the
 * traffic, so a peer's tool calls spend the OWNER's personal allowance.
 *
 * ⚠ **THIS SUPERSEDES THE REROUTE-TO-A-STANDARD-WORKSPACE RULE (2026-09-07,
 * Samuel's per-seat + personal-wallet ruling).** Until this wave a container
 * burn was charged to the owner's SOLE owned standard workspace, and refused
 * (unmetered + logged) when they owned none or owned two —
 * `findSoleOwnedStandardWorkspace`, with its two refusal reasons. Home spend is
 * its own wallet now, so that lookup is off the credit path entirely: an owner
 * with no workspace is billed normally, and an owner with five has nothing to
 * disambiguate. The function still exists for the Stripe webhook's grandfather
 * path, which asks a genuinely different question.
 *
 * ⚠ **`kind='personal'` SKIPS THE OWNER LOOKUP, AND THAT IS A ROUND TRIP, NOT
 * A SHORTCUT.** A personal container has exactly one member, its owner
 * (`20260920120000` §3), and only that owner can be authorized into it — so the
 * caller IS the payer, provably, and asking the database would be paying for an
 * answer we already hold on the hottest path in the product.
 */
export async function resolveBillingTarget(
  workspaceId: string,
  caller: CreditCaller
): Promise<BillingTarget> {
  if (isStandardWorkspace({ kind: caller.workspaceKind })) {
    return { wallet: "seat", workspaceId, payerUserId: caller.userId };
  }
  if (caller.workspaceKind === "personal") {
    return { wallet: "personal", workspaceId, payerUserId: caller.userId };
  }
  const ownerUserId = await findActiveOwnerUserId(workspaceId);
  if (!ownerUserId) {
    return {
      wallet: null,
      workspaceId,
      payerUserId: null,
      reason: "container-has-no-active-owner",
    };
  }
  return { wallet: "personal", workspaceId, payerUserId: ownerUserId };
}

/** What a wallet's credit meter says right now. */
export interface CreditsSummary extends CreditPeriod {
  /** Which counter these numbers came off. `null` = none was read; see
   *  `unmetered()`. */
  wallet: WalletKind | null;
  used: number;
  limit: number;
  remaining: number;
  /** Present only when the zeroes were NOT measured — see `unmetered()`. Absent
   *  on every real reading, so a renderer can tell "nothing spent" from
   *  "nothing counted". */
  degraded?: true;
}

/** The consume decision, plus everything a refusal needs to explain itself. */
export interface CreditConsumeResult extends CreditsSummary {
  allowed: boolean;
  /** Where an exhausted caller is sent, or `""` when there is nothing to buy.
   *  In the RESPONSE because the MCP server package cannot import the
   *  server-side `upgradeUrl()`. */
  upgradeUrl: string;
}

/**
 * Credit window for a billing row (null row = calendar month). SEAT wallets
 * only — a personal wallet has no subscription to anchor to and uses
 * `personalCreditPeriod()`.
 *
 * ⚠ `entitledPlan` is the VERDICT, not `billing.plan`: a free verdict ignores
 * the subscription anchor outright, which un-sticks a workspace canceled
 * mid-period (`../credits.ts › resolveCreditPeriod`). Both callers —
 * enforcement and the settings meter — must pass the SAME verdict.
 */
export function creditPeriodFor(
  billing: WorkspaceBillingRow | null,
  entitledPlan: PlanId
): CreditPeriod {
  return resolveCreditPeriod(
    {
      currentPeriodStart: billing?.currentPeriodStart ?? null,
      currentPeriodEnd: billing?.currentPeriodEnd ?? null,
    },
    entitledPlan
  );
}

/**
 * ⚠ A SEAT ON A FREE-VERDICT WORKSPACE IS THE ONLY THING WITH SOMETHING TO BUY.
 * A personal wallet has no paid tier this wave (`PERSONAL_MONTHLY_CREDITS` is
 * one constant), and a seat on a live paid plan is already on the best
 * allowance there is — pointing either at a checkout is an upsell to nowhere,
 * and the MCP refusal renders the url literally when it is non-empty
 * (`tools/respond.ts › creditsExhausted`).
 */
function upgradeUrlFor(wallet: WalletKind | null, plan: PlanId | null): string {
  return wallet === "seat" && plan === "free" ? upgradeUrl() : "";
}

/**
 * Read-only meter for ONE wallet — the caller's own. Takes the resolved target
 * plus the billing row and member count rather than re-reading them, because
 * its one caller has just paid for those reads (`getWorkspaceEntitlements`
 * alone is three queries).
 */
export async function summarizeCredits(
  target: BillingTarget,
  billing: WorkspaceBillingRow | null,
  memberCount: number
): Promise<CreditsSummary> {
  if (target.wallet === null) return unmeteredSummary();
  if (target.wallet === "personal") {
    const period = personalCreditPeriod();
    const used = await getUserCreditsUsed(target.payerUserId, period.periodStart);
    return {
      ...period,
      wallet: "personal",
      used,
      limit: PERSONAL_MONTHLY_CREDITS,
      remaining: Math.max(0, PERSONAL_MONTHLY_CREDITS - used),
    };
  }
  const plan = entitledPlanFor(billing, memberCount);
  const period = creditPeriodFor(billing, plan);
  const limit = seatCreditsForPlan(plan);
  const used = await getMemberCreditsUsed(
    target.workspaceId,
    target.payerUserId,
    period.periodStart
  );
  return {
    ...period,
    wallet: "seat",
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/**
 * Charge one MCP tool call to the wallet the addressed container names, then
 * spend `CREDITS_PER_MCP_CALL` through that wallet's atomic upsert-CAS RPC.
 * `allowed: false` = out of credits this period; data intact, next period rolls
 * the counter.
 *
 * THROWS on an unexpected read/RPC failure — fail DIRECTION is the route's
 * decision (`POST /api/mcp/credits/consume`).
 *
 * ⚠ **THE ROUND-TRIP BUDGET IS PER WALLET, AND EVERY NUMBER IS PINNED BY MOCK
 * CALL COUNTS** in `credits-service.test.ts`:
 *   * SEAT — billing row + member count (concurrent), then the RPC: **3**.
 *   * `link` — the owner lookup, then the RPC: **2**.
 *   * `personal` — the RPC alone: **1**. The owner IS the caller.
 * Do NOT reintroduce `getWorkspaceEntitlements` on any of them: it fans out to a
 * `COUNT(*)` over `ontology_objects` for a cap this path never consults, plus a
 * second `workspace_billing` read. This runs once per MCP tool call.
 * ⚠ **THE PERSONAL ARM READS NO BILLING ROW AT ALL** — one tier, one constant,
 * no anchor. Adding a read there to "check the plan" would double the cost of
 * the most common burn in the product for an answer that has one value.
 */
export async function consumeMcpCredits(
  workspaceId: string,
  caller: CreditCaller
): Promise<CreditConsumeResult> {
  const target = await resolveBillingTarget(workspaceId, caller);
  if (target.wallet === null) {
    // ⚠ FAIL OPEN, BUT NEVER SILENTLY. Unmetered usage is a decision (see
    // `unmetered()`), and a decision with no trace is indistinguishable from the
    // 403-and-swallow this path replaced (F-325). One line names the container,
    // the caller and WHY nothing was charged.
    console.warn(
      `[credits] unmetered MCP burn in workspace ${workspaceId} by user ${caller.userId}: ${target.reason}`
    );
    return unmetered();
  }

  const spend =
    target.wallet === "personal"
      ? await spendPersonal(target.payerUserId)
      : await spendSeat(target.workspaceId, target.payerUserId);

  if (spend.outcome.allowed) {
    // ⚠ **ATTRIBUTION ONLY, AND ONLY ON A SPEND.** A refused consume moved no
    // counter, so it has nothing to attribute; writing one would put credits in
    // the by-channel rail that nobody was charged for.
    // ⚠ **NOT AWAITED — the answer is already decided.** This is the hottest
    // write path in the product and the ledger is best-effort by design
    // (`credit-ledger.ts`): it swallows its own errors, so there is no rejection
    // to handle, and `void` states that the ordering is deliberately unobserved.
    // ⚠ `workspaceId` AND `originWorkspaceId` ARE BOTH THE ADDRESSED CONTAINER
    // since 2026-09-07 — the payer is a PERSON now and rides `payerUserId`, so
    // there is no second workspace for the first column to hold. `/home`'s rails
    // read the origin and are unaffected.
    void recordCreditUsageEvent({
      workspaceId,
      originWorkspaceId: workspaceId,
      userId: caller.userId,
      wallet: target.wallet,
      payerUserId: target.payerUserId,
      amount: CREDITS_PER_MCP_CALL,
      periodStart: spend.period.periodStart,
    });
  }

  return {
    ...spend.period,
    wallet: target.wallet,
    allowed: spend.outcome.allowed,
    used: spend.outcome.used,
    limit: spend.limit,
    remaining: Math.max(0, spend.limit - spend.outcome.used),
    upgradeUrl: upgradeUrlFor(target.wallet, spend.plan),
  };
}

/** One wallet's spend, with everything the answer is rendered from. */
interface WalletSpend {
  period: CreditPeriod;
  limit: number;
  /** The entitled plan, on the seat arm only — a personal wallet has none, and
   *  `upgradeUrlFor` reads the distinction. */
  plan: PlanId | null;
  outcome: { allowed: boolean; used: number };
}

/** Personal wallet: one round trip, one constant, no billing row. */
async function spendPersonal(payerUserId: string): Promise<WalletSpend> {
  const period = personalCreditPeriod();
  const outcome = await consumeUserCredits(
    payerUserId,
    period.periodStart,
    CREDITS_PER_MCP_CALL,
    PERSONAL_MONTHLY_CREDITS
  );
  return { period, limit: PERSONAL_MONTHLY_CREDITS, plan: null, outcome };
}

/** Seat wallet: the billing row and member count decide the verdict, the
 *  verdict decides both the window and the PER-MEMBER limit. */
async function spendSeat(
  workspaceId: string,
  payerUserId: string
): Promise<WalletSpend> {
  const [billing, memberCount] = await Promise.all([
    getWorkspaceBilling(workspaceId),
    countActiveMembers(workspaceId),
  ]);
  const plan = entitledPlanFor(billing, memberCount);
  const period = creditPeriodFor(billing, plan);
  const limit = seatCreditsForPlan(plan);
  const outcome = await consumeMemberCredits(
    workspaceId,
    payerUserId,
    period.periodStart,
    CREDITS_PER_MCP_CALL,
    limit
  );
  return { period, limit, plan, outcome };
}

/**
 * A burn with no wallet to charge: a container with no active owner row.
 *
 * ⚠ FAIL OPEN, AND IT IS A RULING RATHER THAN AN OVERSIGHT (Samuel, 2026-08-26,
 * on lowering the consume floor): refusing would brick a relationship on the
 * strength of the OTHER party's billing — a guest doing legitimate work in a
 * channel they were invited into would see "out of credits" for an allowance
 * that is not theirs and that they cannot buy. The honesty requirement is that
 * it is LOGGED, not silent: `consumeMcpCredits` warns with the reason before
 * returning this. Zeroed counters, because nothing was measured.
 *
 * ⚠ **THE BRANCH IS NEARLY UNREACHABLE AND STAYS ANYWAY.**
 * `20260720184806_workspace_last_active_owner_guard.sql` stops a workspace
 * losing its last active owner, so this is the answer to a state the database
 * says cannot exist — which is exactly the kind of branch that must not throw.
 *
 * ⚠ `degraded: true` IS THE SAME STAMP THE ROUTE'S `failOpen()` PUTS ON ITS
 * OWN ZEROES, and it must be: both answers are "allowed, and these numbers mean
 * nothing", and a reader that can only recognise one of them puts a made-up
 * `used: 0` on the settings meter as if it were measured.
 *
 * ⚠ `upgradeUrl` IS EMPTY, MATCHING `failOpen()` BYTE FOR BYTE (2026-09-07). It
 * carried the billing link until this wave, which pointed a caller at a
 * checkout for a refusal that never happened — and the two degraded answers
 * differing at all is what makes one reader treat them differently.
 */
export function unmetered(): UnmeteredResult {
  return {
    ...personalCreditPeriod(),
    wallet: null,
    allowed: true,
    used: 0,
    limit: 0,
    remaining: 0,
    upgradeUrl: "",
    degraded: true,
  };
}

/** A `CreditConsumeResult` whose counters were never measured. */
export type UnmeteredResult = CreditConsumeResult & { degraded: true };

/**
 * `unmetered()` narrowed to the METER's fields — the same zeroes, minus the
 * consume decision.
 *
 * ⚠ ONE DEFINITION, TWO CALLERS (`summarizeCredits` and `status-service.ts`).
 * Two hand-written copies of "the degraded reading" is how one surface comes to
 * report a `degraded` stamp the other omits, and the whole point of the stamp is
 * that one reader recognises every degraded answer.
 */
export function unmeteredSummary(): CreditsSummary {
  const { periodStart, periodEnd, wallet, used, limit, remaining, degraded } =
    unmetered();
  return { periodStart, periodEnd, wallet, used, limit, remaining, degraded };
}
