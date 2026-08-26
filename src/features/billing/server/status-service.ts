import "server-only";
import { getWorkspaceEntitlements } from "./entitlements";
import { getWorkspaceBilling } from "./workspace-billing";
import {
  resolveBillingTarget,
  summarizeCredits,
  unmetered,
  type CreditCaller,
  type CreditsSummary,
} from "./credits-service";

/** The consume path's unmetered answer, narrowed to the meter's fields. */
function unmeteredSummary(): CreditsSummary {
  const { periodStart, periodEnd, used, limit, remaining, degraded } = unmetered();
  return { periodStart, periodEnd, used, limit, remaining, degraded };
}

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
  workspaceId: string,
  caller?: CreditCaller
): Promise<WorkspaceBillingStatusPayload> {
  // ⚠ Same reroute as the consume path, or the meter would report a link
  // container's empty counter while enforcement charges a real plan.
  const resolved = await resolveBillingTarget(workspaceId, caller);

  // 🔒 ⚠ THE METER IS NARROWED TO THE PAYER, AND THAT IS A FENCE RATHER THAN A
  // NICETY (2026-08-26, with the charge-the-operator ruling). Enforcement now
  // charges a container's burn to the CONTAINER'S OWNER, and this payload is far
  // more than a credit count: plan, member count, seat count, object cap and
  // `objectsUsed` all come from whichever workspace `target` names. Handing the
  // owner's target to a PEER would print the operator's private standard
  // workspace — its plan and its size — inside a two-person relationship, to
  // somebody who reaches this route on the wrapper's plain `viewer` default (a
  // `member`-granted link claimer, or a legacy unbound claimer at `admin`).
  // A non-payer therefore falls to the SAME unresolvable posture as before:
  // the container's own (empty) entitlements plus stamped zeroes. `payerUserId`
  // is null on the standard path, where the workspace pays for itself.
  const target =
    resolved.payerUserId === null || resolved.payerUserId === caller?.userId
      ? resolved.workspaceId
      : null;

  // ⚠ UNRESOLVABLE IS ITS OWN ANSWER, not a fallback to the container id. With
  // `?? workspaceId` the meter reads the container's untouched counter and
  // reports "0 of 200 used" against a free plan, while enforcement is running
  // UNMETERED and charging nothing — two surfaces describing the same call
  // differently. Reporting the consume path's own posture, `degraded` stamp
  // included, is the only way they agree (see `credits-service.ts ›
  // resolveBillingTarget`). ⚠ For a NON-PAYER peer the two surfaces now agree
  // only about the peer: enforcement IS charging the owner. `degraded` says the
  // zeroes were not measured, which stays true.
  const [entitlements, billing] = await Promise.all([
    getWorkspaceEntitlements(target ?? workspaceId),
    getWorkspaceBilling(target ?? workspaceId),
  ]);
  // ⚠ Credits read the ENTITLED plan and the same period helpers the consume
  // path uses, so the meter cannot disagree with what enforcement charges.
  const credits: CreditsSummary = target
    ? await summarizeCredits(target, entitlements.plan, billing)
    : unmeteredSummary();

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
