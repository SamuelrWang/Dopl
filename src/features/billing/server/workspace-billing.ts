import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Single billing repository: `workspace_billing` plus the two counts the
 * entitlements layer needs (active members, live ontology objects). Keeps
 * `entitlements.ts` unit-testable by mocking this module.
 *
 * A `workspace_billing` row is not always a workspace's (2026-09-08): the
 * personal Pro tier is billed on the `kind='home'` container's own row
 * (spec §11.1), so every function here answers for containers too and
 * `getPersonalBilling` is the one lookup that goes owner → container → row.
 */

/** Mirrors `workspace_billing_plan_check` in the database
 *  (`20260930130000_workspace_billing_plan_pro.sql`) and `../plans.ts › PlanId`.
 *  A value this union has and the CHECK lacks is a `23514` raised inside the
 *  Stripe webhook, which Stripe then retries forever. */
export type WorkspaceBillingPlan = "free" | "solo" | "team" | "pro";
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
  /** Subscription period ANCHOR. `currentPeriodStart` rolls the MCP credit
   *  window on the workspace's billing date; null → calendar month. */
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** Stripe's `cancel_at_period_end`: live now, will not renew. */
  cancelAtPeriodEnd: boolean;
  /** Stripe `event.created` (epoch seconds) of the last applied event — the
   *  watermark that drops stale/out-of-order replays. */
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
    // `?? false` is type-level narrowing, not a pre-migration fallback. The real
    // coupling is deploy order: this code must not ship ahead of
    // `20260811130000_mcp_credits.sql` or every billing read 400s. Verify against
    // the database, never a migration header (docs/INVARIANTS.md §12).
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
 * The caller's HOME space and its billing row, in ONE round trip.
 *
 * The embed is why this function exists: it is on the MCP credit path (once per
 * tool call), and "find the container, then read its row" is two sequential
 * round trips. PostgREST answers both over the
 * `workspace_billing.workspace_id` → `workspaces.id` foreign key. Splitting it
 * back into two reads fails `credits-service.test.ts`'s mock call counts, which
 * is the intended alarm.
 *
 * `null` = the user has no home space, a state the database says is
 * impossible (backfill + `ensure_home_space`); the branch stays because
 * this read must return rather than throw on the hottest path.
 * `{ containerId, billing: null }` is the different answer: the container exists
 * and has never been billed, i.e. a free home space.
 */
export async function getPersonalBilling(
  ownerUserId: string
): Promise<{ containerId: string; billing: WorkspaceBillingRow | null } | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspaces")
    .select(`id, workspace_billing(${BILLING_COLS})`)
    .eq("owner_id", ownerUserId)
    .eq("kind", "home")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { id: string; workspace_billing: unknown };
  return { containerId: row.id, billing: mapEmbeddedBillingRow(row.workspace_billing) };
}

/**
 * The embedded `workspace_billing` of a `workspaces` row → the mapped row.
 *
 * An embedded 1:1 arrives as an object or as a one-element array: PostgREST
 * decides from the constraints and that inference has changed across releases,
 * so a reader handling only the shape it saw in dev reads `undefined` in
 * production and reports every Pro home space as free. Both shapes, one mapper.
 */
function mapEmbeddedBillingRow(embedded: unknown): WorkspaceBillingRow | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  return row ? mapBillingRow(row as BillingRowShape) : null;
}

/** Insert-or-update a billing row. Stamps `updated_at`; `created_at` comes
 *  from the table default on first insert. */
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
 * Take the short-lived cross-instance checkout claim. True iff THIS caller won;
 * false means another checkout is in flight (route → 409). Atomic
 * compare-and-set in Postgres (`claim_workspace_checkout`, self-expires after
 * 2 min) so it holds across Vercel lambda instances, where an in-process guard
 * cannot. Migration 20260720210814_workspace_billing_checkout_claim.sql.
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
 * Release the checkout claim (best-effort). Called only by the checkout
 * route, in its `finally`, on every path — otherwise an abandoned or
 * plan-switching checkout is blocked for the full 2-minute expiry. The webhook
 * does NOT touch the claim. Clearing an expired/cleared claim is a no-op.
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
 * Team-plan workspaces with a live sub (`active`/`past_due`) and a
 * subscription id — the exact set `syncSeatQuantity` can true up. Solo is flat
 * and canceled/free have no live sub, so both are excluded. Daily cron.
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
 * Freshness watermark: Stripe `event.created` (epoch seconds) of the last
 * applied billing event, null when never stamped. The webhook compares an
 * incoming event's `created` against it to drop stale replays.
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

/** Active member count = seat quantity for the per-seat Pro price. */
export async function countActiveMembers(workspaceId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (error) throw error;
  return count ?? 0;
}

/**
 * The pooled counter's accessors (`consumeWorkspaceCredits`,
 * `getWorkspaceCreditsUsed`) left on 2026-09-07; the per-payer replacements live
 * in `./credit-wallets.ts`. The table and RPC are still there
 * (`20260930120000_credit_wallets.sql` §5 retires them from writes and drops
 * nothing), so deleting the wrappers is what makes "nothing writes the retired
 * counter" a code fact rather than a comment. Do not re-export them.
 */

/** Live (non-trashed) ontology objects — the object cap meter. */
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
