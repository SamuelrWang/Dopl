import "server-only";
import {
  CREDITS_PER_MCP_CALL,
  monthlyCreditsForPlan,
  resolveCreditPeriod,
  type CreditPeriod,
} from "../credits";
import { getWorkspaceEntitlements, upgradeUrl } from "./entitlements";
import {
  consumeWorkspaceCredits,
  getWorkspaceCreditsUsed,
  getWorkspaceBilling,
  type WorkspaceBillingRow,
} from "./workspace-billing";

/**
 * MCP credits — the business logic between the route and the repository.
 *
 * The NUMBERS are not here: allowances, the per-call cost and the period rule
 * all live in `../credits.ts`, the one retune spot. This module owns only the
 * two questions that need the database — "may this call proceed" (consume) and
 * "how much is left" (summary).
 *
 * THE PLAN IS THE ENTITLEMENT VERDICT, never `workspace_billing.plan`. A solo
 * subscription that has grown a second member is DEGRADED to free by
 * `entitlements.ts › paidEntitlement`, and reading the raw column would hand
 * that workspace 10,000 credits it is not entitled to.
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
  /** Where an exhausted caller is sent. Carried in the RESPONSE because the
   *  MCP server package cannot import the server-side `upgradeUrl()`. */
  upgradeUrl: string;
}

/** The credit window for a billing row (null row = calendar month). */
export function creditPeriodFor(billing: WorkspaceBillingRow | null): CreditPeriod {
  return resolveCreditPeriod({
    currentPeriodStart: billing?.currentPeriodStart ?? null,
    currentPeriodEnd: billing?.currentPeriodEnd ?? null,
  });
}

/**
 * Read-only meter for a workspace whose plan + billing row the caller ALREADY
 * has. Takes both rather than re-reading them, because its one caller (the
 * billing status service) has just paid for those reads and
 * `getWorkspaceEntitlements` alone is three queries.
 */
export async function summarizeCredits(
  workspaceId: string,
  plan: Parameters<typeof monthlyCreditsForPlan>[0],
  billing: WorkspaceBillingRow | null
): Promise<CreditsSummary> {
  const period = creditPeriodFor(billing);
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
 * Charge one MCP tool call to a workspace. Resolves the entitled plan and the
 * credit window, then spends `CREDITS_PER_MCP_CALL` through the atomic
 * upsert-CAS RPC. `allowed: false` means the workspace is out of credits for
 * this period — the data is intact, the next period rolls the counter.
 *
 * THROWS on an unexpected read/RPC failure. The fail DIRECTION is the route's
 * decision, not this function's — see `POST /api/mcp/credits/consume`.
 */
export async function consumeMcpCredits(
  workspaceId: string
): Promise<CreditConsumeResult> {
  const [entitlements, billing] = await Promise.all([
    getWorkspaceEntitlements(workspaceId),
    getWorkspaceBilling(workspaceId),
  ]);
  const period = creditPeriodFor(billing);
  const limit = monthlyCreditsForPlan(entitlements.plan);
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
