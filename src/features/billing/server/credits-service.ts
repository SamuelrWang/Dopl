import "server-only";
import {
  findActiveOwnerUserId,
  findSoleOwnedStandardWorkspace,
} from "@/features/workspaces/server/repository";
import {
  isStandardWorkspace,
  type WorkspaceKind,
} from "@/features/workspaces/types";
import {
  CREDITS_PER_MCP_CALL,
  monthlyCreditsForPlan,
  resolveCreditPeriod,
  type CreditPeriod,
} from "../credits";
import type { PlanId } from "../plans";
import { recordCreditUsageEvent } from "./credit-ledger";
import { entitledPlanFor, upgradeUrl } from "./entitlements";
import {
  consumeWorkspaceCredits,
  countActiveMembers,
  getWorkspaceCreditsUsed,
  getWorkspaceBilling,
  type WorkspaceBillingRow,
} from "./workspace-billing";

/**
 * MCP credits — business logic between route and repository. NUMBERS live in
 * `../credits.ts` (the one retune spot); this owns only the two questions that
 * need the database: "may this call proceed" and "how much is left".
 *
 * ⚠ The plan is the ENTITLEMENT VERDICT, never `workspace_billing.plan` — a
 * solo sub that grew a second member is degraded to free by
 * `entitlements.ts › paidEntitlement`, and the raw column would hand it 10,000
 * credits it is not entitled to.
 */

/** Who is burning the credit, for the link-container reroute below. */
export interface CreditCaller {
  userId: string;
  /** The TARGET workspace's kind. Absent = standard (column not yet applied). */
  workspaceKind?: WorkspaceKind;
}

/** Why a burn found no counter to move. Never silent — `consumeMcpCredits` logs it. */
export type UnmeteredReason =
  | "container-has-no-active-owner"
  | "container-owner-has-no-billing-workspace"
  /** ⚠ THE REFUSAL THAT REPLACED A GUESS (B10, spec §7 (a)). The owner owns 2+
   *  standard workspaces and no rule says which one pays; charging the oldest
   *  was the old answer and it is a charge nobody chose. */
  | "container-owner-has-ambiguous-billing-workspace";

/** Which counter a burn moves, and whose allowance that is. */
export interface BillingTarget {
  /** The workspace whose counter moves. `null` → nothing to charge. */
  workspaceId: string | null;
  /**
   * The user whose allowance is being spent, when the payer is a PERSON rather
   * than the addressed workspace itself. `null` on the standard path (a tenant
   * pays for itself) and whenever the container has no resolvable owner.
   */
  payerUserId: string | null;
  /** Set iff `workspaceId` is null. */
  reason?: UnmeteredReason;
}

/**
 * Which workspace's counter a charge aimed at `workspaceId` actually lands on.
 * Standard workspace → itself. `null` workspaceId → nothing to charge.
 *
 * 🔒 **A CONTAINER'S BURN IS CHARGED TO THE OPERATOR — THE CONTAINER'S OWNER —
 * WHOEVER MADE THE CALL (Samuel, 2026-08-26: "charge MCP calls from a guest to
 * the user").** A `link` container is a relationship and a `personal` container
 * is a shelf; neither is a tenant and neither carries a plan. The person who
 * minted the container is the one who invited the traffic, so the guest's (or
 * any peer's) tool calls land on the OWNER's SOLE owned STANDARD workspace.
 *
 * 🔒 **AND IT REFUSES ON AMBIGUITY RATHER THAN GUESSING (B10, spec §7's answer
 * (a) — the one option that changes nobody's bill).** The lookup this used to
 * call answered "the oldest owned" and called it the default; with no default
 * left to derive, an owner of two workspaces has no rule saying which one pays.
 * A refusal is an unmetered call somebody can read in a log; a guess is a charge
 * against a workspace nobody chose, and it is silent. One function reverses
 * this, which is why the choice lives in `findSoleOwnedStandardWorkspace` and
 * not in three branches here.
 *
 * ⚠ THIS REPLACES "each side spends their own allowance" (the 2026-08-23
 * PROVISIONAL wiring). That version resolved the CALLER's own workspace, which
 * for a guest was either their unrelated workspace or nothing at all, and in
 * practice was nothing: the route floor 403'd every guest and the registrar
 * failed open, so guest traffic was free (F-325). Owner-resolution is the half
 * that makes the lowered floor mean something; reverting it silently re-bills
 * the wrong party.
 *
 * ⚠ FOR THE OWNER'S OWN CALLS IN THEIR OWN SOLO CONTAINER — the overwhelmingly
 * common case, and the only shape 15 accounts have — the answer is identical to
 * the old one: owner === caller, one owned workspace, no ambiguity to refuse.
 *
 * ⚠ COSTS ONE EXTRA ROUND TRIP on the container path only (owner, then the
 * owner's workspaces). The standard path still asks nothing.
 */
export async function resolveBillingTarget(
  workspaceId: string,
  caller?: CreditCaller
): Promise<BillingTarget> {
  if (!caller || isStandardWorkspace({ kind: caller.workspaceKind })) {
    return { workspaceId, payerUserId: null };
  }
  const ownerUserId = await findActiveOwnerUserId(workspaceId);
  if (!ownerUserId) {
    return {
      workspaceId: null,
      payerUserId: null,
      reason: "container-has-no-active-owner",
    };
  }
  const { workspace, count } = await findSoleOwnedStandardWorkspace(ownerUserId);
  if (workspace) return { workspaceId: workspace.id, payerUserId: ownerUserId };
  return {
    workspaceId: null,
    payerUserId: ownerUserId,
    reason:
      count === 0
        ? "container-owner-has-no-billing-workspace"
        : "container-owner-has-ambiguous-billing-workspace",
  };
}

/** The charge target alone. Kept as the narrow accessor for callers that do not
 *  need to know WHOSE allowance moved — the meter does (`status-service.ts`). */
export async function resolveBillingWorkspaceId(
  workspaceId: string,
  caller?: CreditCaller
): Promise<string | null> {
  return (await resolveBillingTarget(workspaceId, caller)).workspaceId;
}

/** What a workspace's credit meter says right now. */
export interface CreditsSummary extends CreditPeriod {
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
  /** Where an exhausted caller is sent. In the RESPONSE because the MCP server
   *  package cannot import the server-side `upgradeUrl()`. */
  upgradeUrl: string;
}

/**
 * Credit window for a billing row (null row = calendar month).
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
 * Read-only meter; takes plan + billing row rather than re-reading, because its
 * one caller has just paid for those reads (`getWorkspaceEntitlements` alone is
 * three queries).
 */
export async function summarizeCredits(
  workspaceId: string,
  plan: PlanId,
  billing: WorkspaceBillingRow | null
): Promise<CreditsSummary> {
  const period = creditPeriodFor(billing, plan);
  const limit = monthlyCreditsForPlan(plan);
  const used = await getWorkspaceCreditsUsed(workspaceId, period.periodStart);
  return {
    ...period,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/**
 * Charge one MCP tool call. Resolves entitled plan + credit window, then spends
 * `CREDITS_PER_MCP_CALL` through the atomic upsert-CAS RPC. `allowed: false` =
 * out of credits this period; data intact, next period rolls the counter.
 *
 * THROWS on an unexpected read/RPC failure — fail DIRECTION is the route's
 * decision (`POST /api/mcp/credits/consume`).
 *
 * ⚠ THREE ROUND TRIPS IS A BUDGET: billing row + member count (concurrent),
 * then the RPC. Do NOT reintroduce `getWorkspaceEntitlements` here — it fans
 * out to a `COUNT(*)` over `ontology_objects` for a cap this path never
 * consults, plus a second `workspace_billing` read. This runs once per MCP
 * tool call. (A container adds the owner + owned-workspaces reads on top; the
 * standard path is unchanged.)
 */
export async function consumeMcpCredits(
  workspaceId: string,
  caller?: CreditCaller
): Promise<CreditConsumeResult> {
  const resolved = await resolveBillingTarget(workspaceId, caller);
  const target = resolved.workspaceId;
  if (!target) {
    // ⚠ FAIL OPEN, BUT NEVER SILENTLY. Unmetered usage is a decision (below),
    // and a decision with no trace is indistinguishable from the 403-and-swallow
    // this path replaced (F-325). One line names the container, the caller, the
    // payer we found (or did not) and WHY nothing was charged.
    console.warn(
      `[credits] unmetered MCP burn in workspace ${workspaceId} by user ${
        caller?.userId ?? "unknown"
      }: ${resolved.reason ?? "unresolved"} (payer ${
        resolved.payerUserId ?? "none"
      })`
    );
    return unmetered();
  }
  const [billing, memberCount] = await Promise.all([
    getWorkspaceBilling(target),
    countActiveMembers(target),
  ]);
  const plan = entitledPlanFor(billing, memberCount);
  const period = creditPeriodFor(billing, plan);
  const limit = monthlyCreditsForPlan(plan);
  const outcome = await consumeWorkspaceCredits(
    target,
    period.periodStart,
    CREDITS_PER_MCP_CALL,
    limit
  );
  if (outcome.allowed) {
    // ⚠ **ATTRIBUTION ONLY, AND ONLY ON A SPEND.** A refused consume moved no
    // counter, so it has nothing to attribute; writing one would put credits in
    // the by-channel rail that the workspace was never charged for.
    // ⚠ **NOT AWAITED — the answer is already decided.** This is the hottest
    // write path in the product and the ledger is best-effort by design
    // (`credit-ledger.ts`): it swallows its own errors, so there is no rejection
    // to handle, and `void` states that the ordering is deliberately unobserved.
    // ⚠ `originWorkspaceId` IS THE ADDRESSED WORKSPACE, NOT `target` — for a
    // home container those differ (the burn reroutes to the owner's billing
    // workspace) and the difference IS the by-channel dimension.
    void recordCreditUsageEvent({
      workspaceId: target,
      originWorkspaceId: workspaceId,
      userId: caller?.userId ?? null,
      amount: CREDITS_PER_MCP_CALL,
      periodStart: period.periodStart,
    });
  }
  return {
    ...period,
    allowed: outcome.allowed,
    used: outcome.used,
    limit,
    remaining: Math.max(0, limit - outcome.used),
    upgradeUrl: upgradeUrl(),
  };
}

/**
 * A burn with no counter to charge: a link container whose OWNER owns no
 * standard workspace (or, unreachably, one with no active owner row).
 *
 * ⚠ FAIL OPEN, AND IT IS A RULING RATHER THAN AN OVERSIGHT (Samuel, 2026-08-26,
 * on lowering the consume floor): refusing would brick a relationship on the
 * strength of the OTHER party's billing — a guest doing legitimate work in a
 * channel they were invited into would see "out of credits" for a plan that is
 * not theirs and that they cannot buy. The honesty requirement is that it is
 * LOGGED, not silent: `consumeMcpCredits` warns with the reason before
 * returning this. Zeroed counters, because nothing was measured.
 *
 * ⚠ `degraded: true` IS THE SAME STAMP THE ROUTE'S `failOpen()` PUTS ON ITS
 * OWN ZEROES, and it must be: both answers are "allowed, and these numbers mean
 * nothing", and a reader that can only recognise one of them puts a made-up
 * `used: 0` on the settings meter as if it were measured.
 */
export function unmetered(): UnmeteredResult {
  return {
    ...creditPeriodFor(null, "free"),
    allowed: true,
    used: 0,
    limit: 0,
    remaining: 0,
    upgradeUrl: upgradeUrl(),
    degraded: true,
  };
}

/** A `CreditConsumeResult` whose counters were never measured. */
export type UnmeteredResult = CreditConsumeResult & { degraded: true };
