import "server-only";
import { getWorkspaceEntitlements } from "./entitlements";
import { getWorkspaceBilling } from "./workspace-billing";
import { summarizeCredits, type CreditsSummary } from "./credits-service";

/**
 * `GET /api/billing/status` payload, assembled here so the route stays thin
 * (§2) and the shape has ONE server-side definition.
 *
 * ⚠ MUST STAY IN SYNC with its client mirror
 * `features/billing/components/use-workspace-entitlements.ts ›
 * WorkspaceEntitlementsStatus` — edit both together.
 *
 * ⚠ `subscription_period_end` / `has_stripe_customer` keep their snake/flat
 * legacy names: already on the wire, read by shipped clients.
 */
export interface WorkspaceBillingStatusPayload {
  plan: string;
  status: string;
  memberCount: number;
  seatCount: number | null;
  objectCap: number | null;
  objectsUsed: number;
  canCreateObjects: boolean;
  chatsWindowDays: number | null;
  /** MCP credit meter for the CURRENT period. Every plan has one. */
  credits: CreditsSummary;
  /** Live now, will not renew (Stripe's `cancel_at_period_end`). */
  cancelAtPeriodEnd: boolean;
  subscription_period_end: string | null;
  has_stripe_customer: boolean;
}

export async function getWorkspaceBillingStatus(
  workspaceId: string
): Promise<WorkspaceBillingStatusPayload> {
  const [entitlements, billing] = await Promise.all([
    getWorkspaceEntitlements(workspaceId),
    getWorkspaceBilling(workspaceId),
  ]);
  // ⚠ Credits read the ENTITLED plan and the same period helpers the consume
  // path uses, so the meter cannot disagree with what enforcement charges.
  const credits = await summarizeCredits(
    workspaceId,
    entitlements.plan,
    billing
  );

  return {
    plan: entitlements.plan,
    status: entitlements.status,
    memberCount: entitlements.memberCount,
    seatCount: entitlements.seatCount,
    objectCap: entitlements.objectCap,
    objectsUsed: entitlements.objectsUsed,
    canCreateObjects: entitlements.canCreateObjects,
    chatsWindowDays: entitlements.chatsWindowDays,
    credits,
    cancelAtPeriodEnd: billing?.cancelAtPeriodEnd ?? false,
    subscription_period_end: billing?.currentPeriodEnd ?? null,
    has_stripe_customer: !!billing?.stripeCustomerId,
  };
}
