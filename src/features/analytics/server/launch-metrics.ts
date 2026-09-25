import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Launch-metrics aggregations for the admin analytics dashboard. Read-only;
 * admin auth is enforced at the route layer.
 *
 * ⚠ **THESE ARE MEASUREMENTS OF STRIPE, NOT THE PRICE LIST**, and the two
 * answer different questions — never import `billing/prices.ts` here. The
 * $8.99 flip on 2026-09-08 is exactly the day the difference became visible:
 * new Team subscriptions bill $8.99 a seat, and ONE live subscription is still
 * on the $7.99 price (measured 2026-09-08; re-derive, never quote). A single
 * `TEAM_SEAT_MONTHLY_USD` constant could no longer express that, so the price
 * is chosen PER ROW from `workspace_billing.stripe_price_id` against the same
 * env vars Stripe checkout mints with — `STRIPE_LEGACY_SEAT_PRICE_ID` for the
 * old seat price, everything else at the current one.
 *   • `SOLO_MONTHLY_USD` — LEGACY ROWS ONLY. Nothing may buy Solo any more
 *     (`POST /api/billing/checkout` answers 400 `PLAN_RETIRED`), but the live
 *     subscriptions still bill $5.99 and still belong in MRR. The constant and
 *     the `solo` arm retire when the last row does, not before.
 *   • `LEGACY_TEAM_SEAT_MONTHLY_USD` — the $7.99 seat price. ⚠ A row matches it
 *     only when `STRIPE_LEGACY_SEAT_PRICE_ID` is SET in this environment; unset
 *     (dev, preview, and prod once the last legacy sub moves) means every team
 *     row is counted at the current price, which is then the true answer.
 *   • `PRO_MONTHLY_USD` — personal Pro, flat, one per user (2026-09-08). ⚠ It
 *     joined the `.in("plan", …)` filter in the same edit: a paid plan missing
 *     from that list is revenue the dashboard silently reports as zero.
 */

const SOLO_MONTHLY_USD = 5.99;
const TEAM_SEAT_MONTHLY_USD = 8.99;
const LEGACY_TEAM_SEAT_MONTHLY_USD = 7.99;
const PRO_MONTHLY_USD = 8.99;

/** Monthly charge for one paid billing row, from its plan and the price Stripe
 *  is actually billing it on. */
function monthlyUsd(row: PaidBillingRow): number {
  if (row.plan === "solo") return SOLO_MONTHLY_USD;
  if (row.plan === "pro") return PRO_MONTHLY_USD;
  const legacySeatPriceId = process.env.STRIPE_LEGACY_SEAT_PRICE_ID || null;
  const seatPrice =
    legacySeatPriceId && row.stripe_price_id === legacySeatPriceId
      ? LEGACY_TEAM_SEAT_MONTHLY_USD
      : TEAM_SEAT_MONTHLY_USD;
  return Math.max(1, row.seat_count ?? 1) * seatPrice;
}

interface PaidBillingRow {
  plan: "solo" | "team" | "pro";
  seat_count: number | null;
  stripe_price_id: string | null;
}

export interface LaunchMetrics {
  signups_total: number;
  pro_workspaces: number;
  mrr_usd: number;
  daily: Array<{
    day: string; // YYYY-MM-DD
    signups: number;
    subscribed: number;
  }>;
}

export async function getLaunchMetrics(): Promise<LaunchMetrics> {
  const supabase = supabaseAdmin();

  // Billing is CONTAINER-level: 'solo' ($5.99 flat, LEGACY — off sale since
  // 2026-09-07, live rows still bill), 'team' (per seat, price read per row),
  // 'pro' ($8.99 flat, a home space). Canceled reverts to plan='free'
  // and past_due keeps entitlements, so active + past_due are the rows that
  // drive MRR.
  const [{ count: signupsTotal }, { data: paidRows }] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("workspace_billing")
      .select("plan, seat_count, stripe_price_id")
      .in("plan", ["solo", "team", "pro"])
      .in("status", ["active", "past_due"]),
  ]);

  const rows = (paidRows ?? []) as PaidBillingRow[];
  const paying = rows.length;
  const mrrUsd = Number(
    rows.reduce((sum, row) => sum + monthlyUsd(row), 0).toFixed(2)
  );

  // Daily time series (last 30 days) from conversion_events.
  const [signupEvents, subscribedEvents] = await Promise.all([
    fetchEvents("signup"),
    fetchEvents("subscribed"),
  ]);

  const daily = buildDailySeries(signupEvents, subscribedEvents, 30);

  return {
    signups_total: signupsTotal ?? 0,
    pro_workspaces: paying,
    mrr_usd: mrrUsd,
    daily,
  };
}

async function fetchEvents(
  eventType: string
): Promise<Array<{ user_id: string; occurred_at: string }>> {
  const { data } = await supabaseAdmin()
    .from("conversion_events")
    .select("user_id, occurred_at")
    .eq("event_type", eventType);
  return (data ?? []) as Array<{ user_id: string; occurred_at: string }>;
}

function buildDailySeries(
  signups: Array<{ occurred_at: string }>,
  subscribed: Array<{ occurred_at: string }>,
  days: number
): Array<{ day: string; signups: number; subscribed: number }> {
  const buckets: Record<string, { signups: number; subscribed: number }> = {};
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = { signups: 0, subscribed: 0 };
  }
  for (const e of signups) {
    const key = new Date(e.occurred_at).toISOString().slice(0, 10);
    if (key in buckets) buckets[key].signups++;
  }
  for (const e of subscribed) {
    const key = new Date(e.occurred_at).toISOString().slice(0, 10);
    if (key in buckets) buckets[key].subscribed++;
  }
  return Object.entries(buckets).map(([day, v]) => ({ day, ...v }));
}
