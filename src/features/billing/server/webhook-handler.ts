import "server-only";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  countWorkspacesOwnedBy,
  findDefaultWorkspaceForUser,
} from "@/features/workspaces/server/repository";
import { getStripe, selectSeatItem } from "./stripe";
import { syncSeatQuantity } from "./seats";
import { getUserByStripeCustomer } from "./subscriptions";
import {
  findWorkspaceIdByStripeCustomer,
  findWorkspaceIdByStripeSubscription,
  getStripeEventWatermark,
  getWorkspaceBilling,
  upsertWorkspaceBilling,
  type WorkspaceBillingStatus,
  type WorkspaceBillingUpsert,
} from "./workspace-billing";

/**
 * Stripe webhook business logic. The route stays thin: verify the
 * signature, then hand the event here. This owns idempotency (atomic claim
 * via `webhook_events`) and the event → `workspace_billing` mapping.
 *
 * Event map:
 *   checkout.session.completed     -> upsert pro/active (seat_count = qty), re-sync seats
 *   customer.subscription.updated  -> upsert status + seats + period end
 *   customer.subscription.deleted  -> status canceled, plan back to free
 *   invoice.payment_failed         -> status past_due (pro only, sub must match)
 *   invoice.payment_succeeded      -> recover to active only if sub matches
 *
 * Ordering: Stripe delivers at-least-once and without ordering guarantees.
 * Every applied subscription/payment event stamps `event.created` as a
 * freshness watermark; an incoming event whose `created` is <= the stored
 * watermark is stale (a redelivery or out-of-order replay) and is skipped —
 * this is what stops a late `subscription.updated` (active) from resurrecting
 * a workspace that a `subscription.deleted` already canceled.
 *
 * Grandfathering: any subscription lacking a workspace mapping (the one
 * legacy $20 per-user sub) is routed via customer id -> profile ->
 * that user's primary owned workspace, then stamped pro.
 */

export interface ProcessResult {
  received: true;
  duplicate?: boolean;
}

/** Map a Stripe subscription status to our four-state billing status. */
function mapStatus(stripeStatus: Stripe.Subscription.Status): WorkspaceBillingStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    // Never-paid / lapsed states are NON-entitled: folding them into past_due
    // would hand out full Pro entitlements to a sub that never cleared a
    // payment. They revert to free rules.
    case "incomplete":
    case "incomplete_expired":
    case "unpaid":
    case "canceled":
    case "paused":
      return "canceled";
    default:
      return "canceled";
  }
}

/** Resolve (and, when missing, backfill) the workspace behind a Stripe
 *  customer. Falls back to the grandfather path: customer -> user ->
 *  primary owned workspace. */
async function resolveWorkspaceIdForCustomer(
  customerId: string | null
): Promise<string | null> {
  if (!customerId) return null;
  const mapped = await findWorkspaceIdByStripeCustomer(customerId);
  if (mapped) return mapped;
  const userId = await getUserByStripeCustomer(customerId);
  if (!userId) return null;

  // Grandfather path: no workspace_billing row maps this customer, so the
  // legacy per-user subscription is routed to the user's default owned
  // workspace. Warn on the two ambiguous shapes so a mis-mapping is visible.
  const [workspace, ownedCount] = await Promise.all([
    findDefaultWorkspaceForUser(userId),
    countWorkspacesOwnedBy(userId),
  ]);
  if (ownedCount > 1) {
    console.warn(
      `[webhook] Ambiguous grandfather mapping: user ${userId} (customer ${customerId}) owns ${ownedCount} workspaces; routing the legacy subscription to default workspace ${workspace?.id ?? "none"}.`
    );
  }
  if (!workspace) {
    console.warn(
      `[webhook] Legacy subscription for customer ${customerId} (user ${userId}) could not be mapped to any workspace — payment received but no Pro granted.`
    );
    return null;
  }
  return workspace.id;
}

async function resolveWorkspaceIdForSubscription(
  subscription: Stripe.Subscription
): Promise<string | null> {
  const metaWorkspaceId = subscription.metadata?.workspace_id;
  if (metaWorkspaceId) return metaWorkspaceId;
  const bySub = await findWorkspaceIdByStripeSubscription(subscription.id);
  if (bySub) return bySub;
  return resolveWorkspaceIdForCustomer(subscription.customer as string);
}

/** Extract the subscription id an invoice belongs to. Stripe's Basil API
 *  moved this under `parent.subscription_details.subscription`; older
 *  payloads carried a top-level `subscription`. Handles both, string or
 *  expanded object. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parentSub = invoice.parent?.subscription_details?.subscription;
  if (parentSub) return typeof parentSub === "string" ? parentSub : parentSub.id;
  const legacy = (
    invoice as unknown as { subscription?: string | { id: string } | null }
  ).subscription;
  if (legacy) return typeof legacy === "string" ? legacy : legacy.id;
  return null;
}

function subscriptionFields(subscription: Stripe.Subscription) {
  const item = selectSeatItem(subscription);
  // Stripe's Basil API exposes current_period_end on the item; older
  // payloads carried it at the subscription level. Prefer the sub-level
  // value when present, else fall back to the item.
  const subLevelPeriodEnd = (
    subscription as unknown as { current_period_end?: number | null }
  ).current_period_end;
  const periodEnd = subLevelPeriodEnd ?? item?.current_period_end;
  return {
    seatCount: item?.quantity ?? 1,
    stripePriceId: item?.price?.id ?? null,
    currentPeriodEnd: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : undefined,
  };
}

/**
 * Apply a billing patch only when the event is fresh. Compares the incoming
 * `event.created` (epoch seconds) against the workspace's watermark; a
 * stale (older-or-equal) event is skipped. Every applied event stamps the
 * watermark so subsequent stale replays no-op.
 */
async function applyStripeEvent(
  workspaceId: string,
  eventCreated: number,
  patch: WorkspaceBillingUpsert
): Promise<"applied" | "stale"> {
  const watermark = await getStripeEventWatermark(workspaceId);
  if (watermark !== null && eventCreated <= watermark) {
    console.warn(
      `[webhook] Stale event for workspace ${workspaceId} (created=${eventCreated} <= watermark=${watermark}); skipping.`
    );
    return "stale";
  }
  await upsertWorkspaceBilling(workspaceId, {
    ...patch,
    lastStripeEventCreated: eventCreated,
  });
  return "applied";
}

async function handleSubscriptionUpsert(
  subscription: Stripe.Subscription,
  eventCreated: number
): Promise<void> {
  const workspaceId = await resolveWorkspaceIdForSubscription(subscription);
  if (!workspaceId) return;
  const status = mapStatus(subscription.status);
  const fields = subscriptionFields(subscription);
  await applyStripeEvent(workspaceId, eventCreated, {
    plan: status === "canceled" ? "free" : "pro",
    status,
    stripeCustomerId: subscription.customer as string,
    stripeSubscriptionId: subscription.id,
    stripePriceId: fields.stripePriceId,
    seatCount: status === "canceled" ? null : fields.seatCount,
    ...(fields.currentPeriodEnd
      ? { currentPeriodEnd: fields.currentPeriodEnd }
      : {}),
  });
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const workspaceId = session.metadata?.workspace_id;
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  // Prefer explicit metadata; fall back to customer-based resolution so a
  // session that somehow lost its metadata still lands on a workspace.
  const targetWorkspaceId =
    workspaceId ?? (await resolveWorkspaceIdForCustomer(customerId));
  if (!targetWorkspaceId || !subscriptionId) return;

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const status = mapStatus(subscription.status);
  const fields = subscriptionFields(subscription);
  await upsertWorkspaceBilling(targetWorkspaceId, {
    plan: status === "canceled" ? "free" : "pro",
    status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: fields.stripePriceId,
    seatCount: status === "canceled" ? null : fields.seatCount,
    ...(fields.currentPeriodEnd
      ? { currentPeriodEnd: fields.currentPeriodEnd }
      : {}),
  });

  // Members added during checkout (before the sub existed) must get billed:
  // reconcile the seat quantity now. Best-effort — a failure here must not
  // fail the webhook (Stripe would retry the whole event and re-run checkout).
  try {
    await syncSeatQuantity(targetWorkspaceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[webhook] Seat re-sync after checkout failed for workspace ${targetWorkspaceId}: ${message}`
    );
  }
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  eventCreated: number
): Promise<void> {
  const workspaceId = await resolveWorkspaceIdForSubscription(subscription);
  if (!workspaceId) return;
  await applyStripeEvent(workspaceId, eventCreated, {
    plan: "free",
    status: "canceled",
    stripeSubscriptionId: null,
    stripePriceId: null,
    seatCount: null,
  });
}

async function handlePaymentFailed(
  invoice: Stripe.Invoice,
  eventCreated: number
): Promise<void> {
  const workspaceId = await resolveWorkspaceIdForCustomer(
    invoice.customer as string
  );
  if (!workspaceId) return;
  const billing = await getWorkspaceBilling(workspaceId);
  // Only a Pro row can go past_due — flagging a free row would produce a
  // nonsensical free/past_due state.
  if (billing?.plan !== "pro") {
    console.warn(
      `[webhook] Ignoring invoice.payment_failed for workspace ${workspaceId}: plan is ${billing?.plan ?? "none"}, not pro.`
    );
    return;
  }
  // If the invoice names a subscription, it must be the workspace's own.
  const invoiceSub = invoiceSubscriptionId(invoice);
  if (
    invoiceSub &&
    billing.stripeSubscriptionId &&
    invoiceSub !== billing.stripeSubscriptionId
  ) {
    console.warn(
      `[webhook] Ignoring invoice.payment_failed for workspace ${workspaceId}: invoice sub ${invoiceSub} does not match stored sub ${billing.stripeSubscriptionId}.`
    );
    return;
  }
  // past_due keeps pro entitlements (grace) while surfacing the warning.
  await applyStripeEvent(workspaceId, eventCreated, { status: "past_due" });
}

async function handlePaymentSucceeded(
  invoice: Stripe.Invoice,
  eventCreated: number
): Promise<void> {
  const workspaceId = await resolveWorkspaceIdForCustomer(
    invoice.customer as string
  );
  if (!workspaceId) return;
  const billing = await getWorkspaceBilling(workspaceId);
  const invoiceSub = invoiceSubscriptionId(invoice);
  // Recover to active ONLY when the invoice pays the workspace's own live
  // subscription. Never resurrect a row whose subscription was cleared (a
  // canceled workspace) or a mismatched/unmapped invoice.
  if (
    !billing?.stripeSubscriptionId ||
    !invoiceSub ||
    billing.stripeSubscriptionId !== invoiceSub
  ) {
    console.warn(
      `[webhook] Ignoring invoice.payment_succeeded for workspace ${workspaceId}: invoice sub ${invoiceSub ?? "none"} does not match stored sub ${billing?.stripeSubscriptionId ?? "none"}.`
    );
    return;
  }
  await applyStripeEvent(workspaceId, eventCreated, {
    plan: "pro",
    status: "active",
  });
}

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpsert(
        event.data.object as Stripe.Subscription,
        event.created
      );
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(
        event.data.object as Stripe.Subscription,
        event.created
      );
      break;
    case "invoice.payment_failed":
      await handlePaymentFailed(event.data.object as Stripe.Invoice, event.created);
      break;
    case "invoice.payment_succeeded":
      await handlePaymentSucceeded(
        event.data.object as Stripe.Invoice,
        event.created
      );
      break;
  }
}

/**
 * Idempotent entry point. The claim is atomic: insert the event id (idle if
 * it already exists), then flip `processed` false -> true in a single
 * conditional UPDATE. Only the delivery whose UPDATE matched (returns a row)
 * dispatches; a concurrent duplicate matches nothing and short-circuits. On
 * a dispatch failure the claim is released (`processed` back to false) so
 * Stripe's retry re-processes; success stamps `completed_at`.
 */
export async function processStripeEvent(
  event: Stripe.Event
): Promise<ProcessResult> {
  const supabase = supabaseAdmin();
  const { error: insertError } = await supabase
    .from("webhook_events")
    .insert({ event_id: event.id, event_type: event.type, processed: false });
  if (insertError && insertError.code !== "23505") {
    throw new Error(`Idempotency insert failed: ${insertError.message}`);
  }

  // Atomic claim: exactly one concurrent delivery flips false -> true and
  // gets the row back; every other returns zero rows (already claimed).
  const { data: claimed, error: claimError } = await supabase
    .from("webhook_events")
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq("event_id", event.id)
    .eq("processed", false)
    .select("event_id");
  if (claimError) {
    throw new Error(`Idempotency claim failed: ${claimError.message}`);
  }
  if (!claimed || claimed.length === 0) {
    return { received: true, duplicate: true };
  }

  try {
    await dispatch(event);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Release the claim so Stripe's retry re-processes this event.
    await supabase
      .from("webhook_events")
      .update({ processed: false, last_error: message })
      .eq("event_id", event.id);
    throw err;
  }

  await supabase
    .from("webhook_events")
    .update({ completed_at: new Date().toISOString() })
    .eq("event_id", event.id);

  return { received: true };
}
