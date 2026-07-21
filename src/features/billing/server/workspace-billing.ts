import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Data access for the `workspace_billing` table plus the two counts the
 * entitlements layer needs (active members, live ontology objects).
 *
 * Kept as the single billing repository so the entitlements service and
 * the Stripe webhook read/write billing state through one place, and so
 * `entitlements.ts` is unit-testable by mocking this module.
 */

export type WorkspaceBillingPlan = "free" | "solo" | "team";
export type WorkspaceBillingStatus =
  | "free"
  | "active"
  | "past_due"
  | "canceled";

export interface WorkspaceBillingRow {
  workspaceId: string;
  plan: WorkspaceBillingPlan;
  status: WorkspaceBillingStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  seatCount: number | null;
  currentPeriodEnd: string | null;
  /** Stripe `event.created` (epoch seconds) of the last applied billing
   *  event — the freshness watermark that drops stale/out-of-order replays. */
  lastStripeEventCreated: number | null;
}

export interface WorkspaceBillingUpsert {
  plan?: WorkspaceBillingPlan;
  status?: WorkspaceBillingStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  seatCount?: number | null;
  currentPeriodEnd?: string | null;
  lastStripeEventCreated?: number;
}

const BILLING_COLS =
  "workspace_id, plan, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, seat_count, current_period_end, last_stripe_event_created";

interface BillingRowShape {
  workspace_id: string;
  plan: WorkspaceBillingPlan;
  status: WorkspaceBillingStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  seat_count: number | null;
  current_period_end: string | null;
  last_stripe_event_created: number | null;
}

function mapBillingRow(row: BillingRowShape): WorkspaceBillingRow {
  return {
    workspaceId: row.workspace_id,
    plan: row.plan,
    status: row.status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    seatCount: row.seat_count,
    currentPeriodEnd: row.current_period_end,
    lastStripeEventCreated: row.last_stripe_event_created,
  };
}

export async function getWorkspaceBilling(
  workspaceId: string
): Promise<WorkspaceBillingRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_billing")
    .select(BILLING_COLS)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapBillingRow(data as BillingRowShape) : null;
}

/**
 * Insert-or-update a workspace's billing row. Always stamps `updated_at`;
 * sets `created_at` only via the table default on first insert.
 */
export async function upsertWorkspaceBilling(
  workspaceId: string,
  patch: WorkspaceBillingUpsert
): Promise<void> {
  const row: Record<string, unknown> = {
    workspace_id: workspaceId,
    updated_at: new Date().toISOString(),
  };
  if (patch.plan !== undefined) row.plan = patch.plan;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.stripeCustomerId !== undefined)
    row.stripe_customer_id = patch.stripeCustomerId;
  if (patch.stripeSubscriptionId !== undefined)
    row.stripe_subscription_id = patch.stripeSubscriptionId;
  if (patch.stripePriceId !== undefined) row.stripe_price_id = patch.stripePriceId;
  if (patch.seatCount !== undefined) row.seat_count = patch.seatCount;
  if (patch.currentPeriodEnd !== undefined)
    row.current_period_end = patch.currentPeriodEnd;
  if (patch.lastStripeEventCreated !== undefined)
    row.last_stripe_event_created = patch.lastStripeEventCreated;

  const { error } = await supabaseAdmin()
    .from("workspace_billing")
    .upsert(row, { onConflict: "workspace_id" });
  if (error) throw error;
}

/**
 * Take the short-lived cross-instance checkout claim for a workspace.
 * Returns true iff THIS caller won the claim; false means another checkout is
 * already in flight (the route turns that into a 409). Atomic compare-and-set
 * in Postgres (`claim_workspace_checkout` — upsert-claim, self-expires after
 * 2 min), so it holds across Vercel lambda instances where an in-process guard
 * cannot. See migration 20260720210814_workspace_billing_checkout_claim.sql.
 */
export async function claimWorkspaceCheckout(
  workspaceId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("claim_workspace_checkout", {
    p_workspace_id: workspaceId,
  });
  if (error) throw error;
  return data === true;
}

/**
 * Release the checkout claim (best-effort). Called on session-create failure
 * and on `checkout.session.completed` so a re-checkout isn't blocked for the
 * full 2-minute self-expiry window. Clearing an already-expired or
 * already-cleared claim is a harmless no-op; once a subscription id is
 * persisted the normal 409 guard takes over regardless.
 */
export async function releaseWorkspaceCheckout(
  workspaceId: string
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("workspace_billing")
    .update({ checkout_claim_at: null } as Record<string, unknown>)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

export async function findWorkspaceIdByStripeCustomer(
  stripeCustomerId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_billing")
    .select("workspace_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  if (error) throw error;
  return (data as { workspace_id: string } | null)?.workspace_id ?? null;
}

export async function findWorkspaceIdByStripeSubscription(
  stripeSubscriptionId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_billing")
    .select("workspace_id")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle();
  if (error) throw error;
  return (data as { workspace_id: string } | null)?.workspace_id ?? null;
}

/**
 * Every Team-plan workspace whose Stripe subscription is still live (status
 * `active` or `past_due`) and has a subscription id — i.e. the exact set
 * whose seat quantity `syncSeatQuantity` can true-up. Solo is flat (never
 * resized) and canceled/free rows have no live sub, so both are excluded.
 * Used by the daily seat-reconciliation cron.
 */
export async function listReconcilableTeamWorkspaceIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_billing")
    .select("workspace_id")
    .eq("plan", "team")
    .in("status", ["active", "past_due"])
    .not("stripe_subscription_id", "is", null);
  if (error) throw error;
  return (data as { workspace_id: string }[] | null)?.map((r) => r.workspace_id) ?? [];
}

/**
 * The freshness watermark for a workspace: the Stripe `event.created`
 * (epoch seconds) of the last applied billing event, or null when the row
 * has never been stamped (or doesn't exist). The webhook handler compares
 * an incoming event's `created` against this to drop stale replays.
 */
export async function getStripeEventWatermark(
  workspaceId: string
): Promise<number | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_billing")
    .select("last_stripe_event_created")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (
    (data as { last_stripe_event_created: number | null } | null)
      ?.last_stripe_event_created ?? null
  );
}

/** Active member count — the seat quantity for the per-seat Pro price. */
export async function countActiveMembers(workspaceId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (error) throw error;
  return count ?? 0;
}

/** Live (non-trashed) ontology objects in a workspace — the object cap meter. */
export async function countOntologyObjects(
  workspaceId: string
): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("ontology_objects")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}
