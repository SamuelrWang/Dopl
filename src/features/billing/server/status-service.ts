import "server-only";
import { getWorkspaceEntitlements } from "./entitlements";
import { getWorkspaceBilling } from "./workspace-billing";
import {
  resolveBillingTarget,
  summarizeCredits,
  // ⚠ THE SAME zeroes the consume path returns, from ONE definition. Two copies
  // of "the degraded reading" is how one surface comes to omit the `degraded`
  // stamp the other sets, and the stamp only works if every reader sees it.
  unmeteredSummary,
  type BillingTarget,
  type CreditCaller,
  type CreditsSummary,
} from "./credits-service";

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
  /** THE CALLER'S OWN credit meter for the current period — their seat, or
   *  their personal wallet. Every caller has one. */
  credits: CreditsSummary;
  /** Live now, will not renew (Stripe's `cancel_at_period_end`). */
  cancelAtPeriodEnd: boolean;
  subscription_period_end: string | null;
  has_stripe_customer: boolean;
}

/**
 * 🔒 **THE METER IS THE CALLER'S OWN WALLET, AND ONLY EVER THEIRS (2026-09-07,
 * with Samuel's per-seat + personal-wallet ruling).** A member reads their seat;
 * a container OWNER reads their personal wallet. A PEER inside somebody's link
 * container reads the unmetered posture — the owner's personal wallet spans
 * every relationship that owner has, so showing it to one peer would print the
 * operator's total home spend inside a two-person channel.
 *
 * ⚠ **THIS REPLACES THE PAYER-NARROWING FENCE, WHICH HAS NOTHING LEFT TO
 * FENCE.** Until this wave the resolver could answer with a DIFFERENT workspace
 * — the container owner's standard workspace — and this payload carries plan,
 * member count, seat count, object cap and `objectsUsed`, so handing a peer
 * that target printed the operator's private workspace inside the relationship.
 * `resolveBillingTarget` now always answers the ADDRESSED container, so the
 * entitlements half reads the workspace the caller is already authorized into
 * and there is no other tenant's row on this path at all. What survives is the
 * CREDIT half of the fence, above: a peer's meter is not the owner's meter.
 *
 * ⚠ For a container the entitlements block therefore describes the CONTAINER
 * (free plan, its own member count, no objects) rather than some workspace the
 * owner also happens to own. That is the honest answer: a container carries no
 * plan, and the credits that pay for it are on a wallet, not a tenant.
 */
export async function getWorkspaceBillingStatus(
  workspaceId: string,
  caller: CreditCaller
): Promise<WorkspaceBillingStatusPayload> {
  const resolved = await resolveBillingTarget(workspaceId, caller);
  const [entitlements, billing] = await Promise.all([
    getWorkspaceEntitlements(workspaceId),
    getWorkspaceBilling(workspaceId),
  ]);
  const credits = await callerCredits(resolved, caller, billing, entitlements);

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

/**
 * The caller's own meter, or the unmetered posture when there is none to show
 * them.
 *
 * ⚠ Credits read the ENTITLED plan and the same period helpers the consume path
 * uses, so the meter cannot disagree with what enforcement charges. The
 * entitlements read already produced the member count the seat verdict needs —
 * it is passed through rather than counted twice.
 */
async function callerCredits(
  resolved: BillingTarget,
  caller: CreditCaller,
  billing: Awaited<ReturnType<typeof getWorkspaceBilling>>,
  entitlements: Awaited<ReturnType<typeof getWorkspaceEntitlements>>
): Promise<CreditsSummary> {
  if (resolved.wallet === null) return unmeteredSummary();
  // 🔒 THE PEER FENCE. A personal wallet belongs to the container's owner; a
  // non-owner asking about it gets the same stamped zeroes the consume path
  // reports, never a reading of somebody else's allowance.
  if (resolved.payerUserId !== caller.userId) return unmeteredSummary();
  return summarizeCredits(resolved, billing, entitlements.memberCount);
}
