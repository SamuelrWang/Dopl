import "server-only";
import { getWorkspaceEntitlements } from "./entitlements";
import { getWorkspaceBilling } from "./workspace-billing";
import { summarizeCredits, type CreditsSummary } from "./credits-service";

/**
 * The `GET /api/billing/status` payload, assembled in one place so the route
 * stays a thin handler (§2) and so the shape has ONE definition on the server
 * side of the wire. Its client mirror is
 * `features/billing/components/use-workspace-entitlements.ts ›
 * WorkspaceEntitlementsStatus` — the two must be edited together.
 *
 * `subscription_period_end` / `has_stripe_customer` keep their snake/flat
 * legacy names: they are already on the wire and read by shipped clients.
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
  // Credits read the ENTITLED plan and the same period helpers the consume
  // path uses, so the meter can never disagree with what enforcement charges.
  // A workspace with no usage row has used 0 (see `getWorkspaceCreditsUsed`).
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
