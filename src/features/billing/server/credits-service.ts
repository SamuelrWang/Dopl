import "server-only";
import {
  CREDITS_PER_MCP_CALL,
  monthlyCreditsForPlan,
  resolveCreditPeriod,
  type CreditPeriod,
} from "../credits";
import type { PlanId } from "../plans";
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

/** What a workspace's credit meter says right now. */
export interface CreditsSummary extends CreditPeriod {
  used: number;
  limit: number;
  remaining: number;
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
 * tool call.
 */
export async function consumeMcpCredits(
  workspaceId: string
): Promise<CreditConsumeResult> {
  const [billing, memberCount] = await Promise.all([
    getWorkspaceBilling(workspaceId),
    countActiveMembers(workspaceId),
  ]);
  const plan = entitledPlanFor(billing, memberCount);
  const period = creditPeriodFor(billing, plan);
  const limit = monthlyCreditsForPlan(plan);
  const outcome = await consumeWorkspaceCredits(
    workspaceId,
    period.periodStart,
    CREDITS_PER_MCP_CALL,
    limit
  );
  return {
    ...period,
    allowed: outcome.allowed,
    used: outcome.used,
    limit,
    remaining: Math.max(0, limit - outcome.used),
    upgradeUrl: upgradeUrl(),
  };
}
