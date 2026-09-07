import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Launch-metrics aggregations for the admin analytics dashboard. Read-only;
 * admin auth is enforced at the route layer.
 *
 * ⚠ Prices hardcoded so MRR matches what Stripe actually CHARGES — keep in sync
 * or read them from env instead. **These are measurements of Stripe, not the
 * price list**, which is why neither number moved on 2026-09-07 when Solo went
 * off sale and Team's list price became $8.00 (spec A6/A7):
 *   • `SOLO_MONTHLY_USD` — LEGACY ROWS ONLY. Nothing may buy Solo any more
 *     (`POST /api/billing/checkout` answers 400 `PLAN_RETIRED`), but the live
 *     subscriptions still bill $5.99 and still belong in MRR. The constant and
 *     the `solo` arm below retire when the last row does, not before.
 *   • `TEAM_SEAT_MONTHLY_USD` — still $7.99 because Stripe's price object still
 *     is. Samuel creates the $8.00 price and flips `STRIPE_PRO_SEAT_PRICE_ID`;
 *     ⚠ existing Team subs KEEP the old price unless migrated, so on the day
 *     that lands this becomes a per-subscription fact and one constant stops
 *     being able to express it. Do NOT bump this to 8 on the strength of the
 *     pricing page — the two answer different questions.
 */

const SOLO_MONTHLY_USD = 5.99;
const TEAM_SEAT_MONTHLY_USD = 7.99;

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

  // Billing is workspace-level: 'solo' ($5.99 flat, LEGACY — off sale since
  // 2026-09-07, live rows still bill), 'team' ($7.99 × seat_count). Canceled
  // reverts to plan='free' and past_due keeps entitlements, so active +
  // past_due are the rows that drive MRR.
  const [{ count: signupsTotal }, { data: paidRows }] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("workspace_billing")
      .select("plan, seat_count")
      .in("plan", ["solo", "team"])
      .in("status", ["active", "past_due"]),
  ]);

  const rows = (paidRows ?? []) as Array<{
    plan: "solo" | "team";
    seat_count: number | null;
  }>;
  const paying = rows.length;
  const mrrUsd = Number(
    rows
      .reduce(
        (sum, row) =>
          sum +
          (row.plan === "solo"
            ? SOLO_MONTHLY_USD
            : Math.max(1, row.seat_count ?? 1) * TEAM_SEAT_MONTHLY_USD),
        0
      )
      .toFixed(2)
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
