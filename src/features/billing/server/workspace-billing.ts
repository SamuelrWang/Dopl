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
  /** Subscription period ANCHOR. `currentPeriodStart` is what lets the MCP
   *  credit window roll on the workspace's own billing date instead of the
   *  1st; null (free / never subscribed) falls back to the calendar month. */
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** Stripe's `cancel_at_period_end`: live now, will not renew. */
  cancelAtPeriodEnd: boolean;
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
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  lastStripeEventCreated?: number;
}

const BILLING_COLS =
  "workspace_id, plan, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, seat_count, current_period_start, current_period_end, cancel_at_period_end, last_stripe_event_created";

interface BillingRowShape {
  workspace_id: string;
  plan: WorkspaceBillingPlan;
  status: WorkspaceBillingStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  seat_count: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
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
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    // The column is NOT NULL DEFAULT false, so `?? false` is a TYPE-LEVEL
    // narrowing (the row shape types it nullable), not a pre-migration
    // fallback — it cannot be one: `BILLING_COLS` names the new columns, and
    // PostgREST answers a select for a column that does not exist with a 400,
    // so there is no "row with the key missing" state to catch. THE REAL
    // COUPLING IS DEPLOY ORDER: this code must not ship ahead of
    // `20260811130000_mcp_credits.sql`, which adds BOTH `current_period_start`
    // and `cancel_at_period_end`, or every billing read 400s. It is applied
    // (verify against the database, never against a migration header — see
    // docs/INVARIANTS.md §12, and the near-miss in REFACTOR-FINDINGS). The
    // `false` still keeps the fail-safe direction (an unknown cancel intent
    // must never read as "your plan is ending").
    cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
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
  if (patch.currentPeriodStart !== undefined)
    row.current_period_start = patch.currentPeriodStart;
  if (patch.currentPeriodEnd !== undefined)
    row.current_period_end = patch.currentPeriodEnd;
  if (patch.cancelAtPeriodEnd !== undefined)
    row.cancel_at_period_end = patch.cancelAtPeriodEnd;
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
 * Release the checkout claim (best-effort). Called ONLY by the checkout route,
 * in its `finally`, once the create-session critical section ends — on every
 * path (success or failure) so an abandoned or plan-switching checkout isn't
 * blocked for the full 2-minute self-expiry window. The webhook no longer
 * touches the claim. Clearing an already-expired or already-cleared claim is a
 * harmless no-op; once a subscription id is persisted the normal 409 guard
 * takes over regardless.
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

/** Outcome of one atomic credit spend: whether it was allowed, and the
 *  counter AFTER the attempt (unchanged when refused). */
export interface CreditConsumeRow {
  allowed: boolean;
  used: number;
}

/**
 * Spend `amount` MCP credits against `(workspaceId, periodStart)`, refusing
 * when it would take the counter past `limit`. Atomic cross-instance
 * compare-and-set in Postgres (`consume_workspace_credits` — a single
 * upsert-CAS statement, no advisory lock), so two concurrent tool calls can
 * never both spend the last credit. See migration 20260811130000_mcp_credits.
 *
 * THROWS on a DB error — the caller decides the fail direction, and the MCP
 * path deliberately fails OPEN (see `credits-service.ts`).
 */
export async function consumeWorkspaceCredits(
  workspaceId: string,
  periodStart: string,
  amount: number,
  limit: number
): Promise<CreditConsumeRow> {
  const { data, error } = await supabaseAdmin().rpc(
    "consume_workspace_credits",
    {
      p_workspace_id: workspaceId,
      p_period_start: periodStart,
      p_amount: amount,
      p_limit: limit,
    }
  );
  if (error) throw error;
  // A `RETURNS TABLE` function comes back as a one-row array.
  const row = (data as { allowed: boolean; used: number }[] | null)?.[0];
  if (!row) {
    throw new Error("consume_workspace_credits returned no row");
  }
  return { allowed: row.allowed === true, used: row.used ?? 0 };
}

/**
 * Credits already spent in `(workspaceId, periodStart)`. NO ROW MEANS ZERO —
 * the counter row is created by the first consume of a period, so "never
 * called an MCP tool this month" and "used 0" are the same state.
 */
export async function getWorkspaceCreditsUsed(
  workspaceId: string,
  periodStart: string
): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_credit_usage")
    .select("used")
    .eq("workspace_id", workspaceId)
    .eq("period_start", periodStart)
    .maybeSingle();
  if (error) throw error;
  return (data as { used: number } | null)?.used ?? 0;
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
