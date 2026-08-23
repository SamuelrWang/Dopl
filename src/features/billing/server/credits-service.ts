import "server-only";
import { findDefaultWorkspaceForUser } from "@/features/workspaces/server/repository";
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

/**
 * Which workspace's counter a charge aimed at `workspaceId` actually lands on.
 * Standard workspace → itself. `null` → nothing to charge; run unmetered.
 *
 * PROVISIONAL (Samuel, 2026-08-23: "bill workspace plans separately; MCP burns
 * bill each side's own plan; wiring now, hash out later"). A `link` container is
 * a two-member relationship, not a tenant, and has no plan — so the burn is
 * charged to the CALLER's own billing workspace: their oldest-owned STANDARD
 * workspace. Each side of a home channel therefore spends their own allowance.
 * `findDefaultWorkspaceForUser` is sanctioned here — its third sanctioned use,
 * alongside signup-bootstrap and the billing grandfather (INVARIANTS §4).
 */
export async function resolveBillingWorkspaceId(
  workspaceId: string,
  caller?: CreditCaller
): Promise<string | null> {
  if (!caller || isStandardWorkspace({ kind: caller.workspaceKind })) {
    return workspaceId;
  }
  const owned = await findDefaultWorkspaceForUser(caller.userId);
  return owned?.id ?? null;
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
 * tool call.
 */
export async function consumeMcpCredits(
  workspaceId: string,
  caller?: CreditCaller
): Promise<CreditConsumeResult> {
  const target = await resolveBillingWorkspaceId(workspaceId, caller);
  if (!target) return unmetered();
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
 * A burn with no counter to charge: a link container whose caller owns no
 * standard workspace. ⚠ FAIL OPEN, matching `POST /api/mcp/credits/consume`'s
 * posture — an unbillable caller in a home channel must not be bricked. Zeroed
 * counters, because nothing was measured.
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
