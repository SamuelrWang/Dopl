import "server-only";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { findSoleOwnedStandardWorkspace } from "@/features/workspaces/server/repository";
import type { PlanId } from "../plans";
import { getStripe, selectSeatItem } from "./stripe";
import { derivePlan, reportPlanContainerMismatch } from "./webhook-plan";
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
 * Stripe webhook business logic; route only verifies the signature. Owns
 * idempotency (atomic claim via `webhook_events`) and the
 * event → `workspace_billing` mapping.
 *
 * Plan derivation and the plan/container-kind check both live in
 * `./webhook-plan.ts` — `derivePlan` (item price → plan, metadata fallback) and
 * `reportPlanContainerMismatch` (a `pro` sub on a standard workspace, or a
 * `team` sub on a personal container, is LOGGED and still written: by this
 * point the money has moved, and `checkout/route.ts` is the fence).
 *
 * ORDERING: Stripe delivers at-least-once, unordered. Every applied event
 * stamps `event.created` as a freshness watermark; `created` <= the stored
 * watermark is skipped. This is what stops a late `subscription.updated`
 * (active) resurrecting a workspace `subscription.deleted` already canceled.
 *
 * Grandfathering: a subscription with no workspace mapping (the one legacy $20
 * per-user sub) routes customer id → profile → that user's SOLE owned standard
 * workspace, and refuses when there is not exactly one.
 */

export interface ProcessResult {
  received: true;
  duplicate?: boolean;
}

/** The plans that bill. Listed rather than derived as the free plan's complement:
 *  a plan added to the taxonomy is not paid until somebody says so here. */
function isPaidPlan(plan: PlanId | undefined): boolean {
  return plan === "solo" || plan === "team" || plan === "pro";
}

/** Map a Stripe subscription status to our four-state billing status. */
function mapStatus(stripeStatus: Stripe.Subscription.Status): WorkspaceBillingStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    // Never-paid / lapsed states are non-entitled — folding them into past_due
    // hands full Pro entitlements to a sub that never cleared.
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

/**
 * Resolve (and backfill) the workspace behind a Stripe customer. Grandfather
 * fallback: customer → user → their SOLE owned standard workspace.
 *
 * B10: ambiguity is a refusal, not a warning. There is no derived default to
 * appeal to, so the mapping has exactly one answer or none; `null` leaves the
 * subscription unmapped, alerted, and repairable by hand. The two refusals say
 * different things — "nothing to map" is a customer with no workspace, "too many"
 * is a customer whose intent was never recorded — so they stay separate messages.
 */
async function resolveWorkspaceIdForCustomer(
  customerId: string | null
): Promise<string | null> {
  if (!customerId) return null;
  const mapped = await findWorkspaceIdByStripeCustomer(customerId);
  if (mapped) return mapped;
  const userId = await getUserByStripeCustomer(customerId);
  if (!userId) return null;

  const { workspace, count } = await findSoleOwnedStandardWorkspace(userId);
  if (workspace) return workspace.id;
  console.error(
    count === 0
      ? `[webhook] Legacy subscription for customer ${customerId} (user ${userId}) could not be mapped to any container — payment received, no paid plan granted.`
      : `[webhook] Legacy subscription for customer ${customerId} (user ${userId}) is ambiguous: they own ${count} workspaces and none is mapped — payment received, no paid plan granted, and nothing guessed. Write the workspace_billing mapping by hand.`
  );
  return null;
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

/** Stripe's Basil API moved this to `parent.subscription_details.subscription`;
 *  older payloads carried a top-level `subscription`. Handles both, string or
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

/** `plan` is passed rather than re-derived so one derivation decides both the
 *  written plan and its seat count; two derivations can disagree. */
function subscriptionFields(subscription: Stripe.Subscription, plan: PlanId) {
  const item = selectSeatItem(subscription);
  // Basil exposes current_period_start/end on the ITEM; older payloads at the
  // subscription level. Prefer sub-level, else item. The start anchors the MCP
  // credit window (`features/billing/credits.ts › resolveCreditPeriod`).
  const subLevel = subscription as unknown as {
    current_period_start?: number | null;
    current_period_end?: number | null;
  };
  const periodStart = subLevel.current_period_start ?? item?.current_period_start;
  const periodEnd = subLevel.current_period_end ?? item?.current_period_end;
  return {
    // `pro` is flat — one container, one member, one price. Pinned so a
    // hand-edited dashboard quantity cannot make a personal container look
    // multi-seat to `entitlements.ts`.
    seatCount: plan === "pro" ? 1 : (item?.quantity ?? 1),
    stripePriceId: item?.price?.id ?? null,
    // Always written, never undefined: a resumed subscription must clear the
    // flag, and an omitted key leaves the old `true` standing.
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    currentPeriodStart: periodStart
      ? new Date(periodStart * 1000).toISOString()
      : undefined,
    currentPeriodEnd: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : undefined,
  };
}

/**
 * Apply a billing patch only when the event is fresh; every applied event
 * stamps the watermark.
 *
 * `<=` is deliberate: Stripe stamps `created` at 1s granularity, so `<` lets an
 * `updated(active)` sharing a `deleted` event's second durably resurrect a
 * canceled sub. Dropping a second legitimate update in that second is transient.
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

  // Any canceled write must null the subscription pointers: a retained sub id
  // lets a later `invoice.payment_succeeded` match it and restore status=active
  // without the plan, stranding a payer at free/active and blocking re-checkout.
  if (status === "canceled") {
    await applyStripeEvent(workspaceId, eventCreated, {
      plan: "free",
      status,
      stripeCustomerId: subscription.customer as string,
      stripeSubscriptionId: null,
      stripePriceId: null,
      seatCount: null,
      // Sub is gone; leftover `true` renders "ends on <date>" after the end.
      cancelAtPeriodEnd: false,
      // The period anchor goes with it: a retained future anchor keeps the MCP
      // credit window on the key the paid plan spent against, locking the caller
      // out until the dead period ends. (`credits.ts › resolveCreditPeriod`
      // also ignores the anchor on a free verdict, healing unreached rows.)
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    return;
  }

  const plan = derivePlan(subscription);
  await reportPlanContainerMismatch(workspaceId, plan);
  const fields = subscriptionFields(subscription, plan);
  await applyStripeEvent(workspaceId, eventCreated, {
    plan,
    status,
    stripeCustomerId: subscription.customer as string,
    stripeSubscriptionId: subscription.id,
    stripePriceId: fields.stripePriceId,
    seatCount: fields.seatCount,
    cancelAtPeriodEnd: fields.cancelAtPeriodEnd,
    ...(fields.currentPeriodStart
      ? { currentPeriodStart: fields.currentPeriodStart }
      : {}),
    ...(fields.currentPeriodEnd
      ? { currentPeriodEnd: fields.currentPeriodEnd }
      : {}),
  });
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventCreated: number
): Promise<void> {
  const workspaceId = session.metadata?.workspace_id;
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  // Metadata first; customer fallback for a session that lost its metadata.
  const targetWorkspaceId =
    workspaceId ?? (await resolveWorkspaceIdForCustomer(customerId));
  if (!targetWorkspaceId || !subscriptionId) return;

  // The webhook does not touch the checkout claim — the route released it in its
  // `finally` long before this event lands. Releasing it here would run before
  // the subscription id is persisted below, which is the durable re-checkout guard.
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const status = mapStatus(subscription.status);
  const plan = derivePlan(subscription);
  if (status !== "canceled") {
    await reportPlanContainerMismatch(targetWorkspaceId, plan);
  }
  const fields = subscriptionFields(subscription, plan);
  // Watermark-guarded like every other billing write: Stripe can retry a failed
  // checkout delivery after the sub was canceled, resurrecting a non-null sub id.
  const applied = await applyStripeEvent(targetWorkspaceId, eventCreated, {
    plan: status === "canceled" ? "free" : plan,
    status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: status === "canceled" ? null : subscriptionId,
    stripePriceId: status === "canceled" ? null : fields.stripePriceId,
    seatCount: status === "canceled" ? null : fields.seatCount,
    cancelAtPeriodEnd: status === "canceled" ? false : fields.cancelAtPeriodEnd,
    // Conditioned on `canceled` like every other paid field above: otherwise a
    // checkout retried after cancellation writes a live future anchor onto a free
    // row, the credit lockout by a path neither cancel handler covers.
    // `undefined` leaves the stored value alone.
    currentPeriodStart: status === "canceled" ? null : fields.currentPeriodStart,
    currentPeriodEnd: status === "canceled" ? null : fields.currentPeriodEnd,
  });
  if (applied === "stale") return;

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
    cancelAtPeriodEnd: false,
    // Same reason as the canceled branch of `handleSubscriptionUpsert`.
    currentPeriodStart: null,
    currentPeriodEnd: null,
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
  // Only a paid row can go past_due; a free/past_due state is nonsensical.
  // `pro` joined the set 2026-09-08 — omitting it would skip dunning for personal
  // Pro subscriptions entirely.
  if (!billing || !isPaidPlan(billing.plan)) {
    console.warn(
      `[webhook] Ignoring invoice.payment_failed for workspace ${workspaceId}: plan is ${billing?.plan ?? "none"}, not a paid plan.`
    );
    return;
  }
  // Flag past_due ONLY for an invoice that positively names the workspace's
  // own subscription — mirrors handlePaymentSucceeded. A one-off invoice
  // (or a payload the extractor can't read) must not push a paid workspace
  // into dunning on customer-id resolution alone.
  const invoiceSub = invoiceSubscriptionId(invoice);
  if (
    !invoiceSub ||
    !billing.stripeSubscriptionId ||
    invoiceSub !== billing.stripeSubscriptionId
  ) {
    console.warn(
      `[webhook] Ignoring invoice.payment_failed for workspace ${workspaceId}: invoice sub ${invoiceSub ?? "none"} does not match stored sub ${billing.stripeSubscriptionId ?? "none"}.`
    );
    return;
  }
  // past_due keeps paid entitlements (grace) while surfacing the warning.
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
  // Recovery only flips status back to active; the row's derived plan
  // (solo/team) is already correct and is left untouched.
  await applyStripeEvent(workspaceId, eventCreated, {
    status: "active",
  });
}

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
        event.created
      );
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
