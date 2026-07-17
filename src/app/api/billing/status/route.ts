import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { getWorkspaceEntitlements } from "@/features/billing/server/entitlements";
import { getWorkspaceBilling } from "@/features/billing/server/workspace-billing";

/**
 * Billing status for the active workspace — the entitlements summary the
 * UI renders (consumed by `useWorkspaceEntitlements`). Any active member
 * may read it.
 */
export const GET = withWorkspaceAuth(async (_request, { workspaceId }) => {
  const [entitlements, billing] = await Promise.all([
    getWorkspaceEntitlements(workspaceId),
    getWorkspaceBilling(workspaceId),
  ]);

  return NextResponse.json({
    plan: entitlements.plan,
    status: entitlements.status,
    memberCount: entitlements.memberCount,
    seatCount: entitlements.seatCount,
    objectCap: entitlements.objectCap,
    objectsUsed: entitlements.objectsUsed,
    canCreateObjects: entitlements.canCreateObjects,
    chatsWindowDays: entitlements.chatsWindowDays,
    subscription_period_end: billing?.currentPeriodEnd ?? null,
    has_stripe_customer: !!billing?.stripeCustomerId,
  });
});
