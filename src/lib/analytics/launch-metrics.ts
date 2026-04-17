import { supabaseAdmin } from "@/lib/supabase";

/**
 * Launch-metrics aggregations for the admin analytics dashboard.
 * All read-only; admin auth is enforced at the route layer.
 *
 * Price hardcoded here so the MRR number matches what Stripe actually
 * charges. If that ever diverges, read it from env instead.
 */

const MONTHLY_PRICE_USD = 7.99;

export interface LaunchMetrics {
  signups_total: number;
  trials_active: number;
  trials_expired: number;
  paying_users: number;
  mrr_usd: number;
  conversion_signup_to_first_cluster_24h_pct: number | null;
  conversion_trial_to_paid_pct: number | null;
  conversion_reactivation_pct: number | null;
  paid_users_who_clustered_in_session1_pct: number | null;
  daily: Array<{
    day: string; // YYYY-MM-DD
    signups: number;
    subscribed: number;
  }>;
}

export async function getLaunchMetrics(): Promise<LaunchMetrics> {
  const supabase = supabaseAdmin();

  // ── Basic counts from profiles ───────────────────────────────────
  const [
    { count: signupsTotal },
    { count: trialsActive },
    { count: trialsExpired },
    { count: payingUsers },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("subscription_status", "trialing")
      .gt("trial_expires_at", new Date().toISOString()),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("subscription_status", "expired"),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("subscription_status", "active"),
  ]);

  const paying = payingUsers ?? 0;
  const mrrUsd = Number((paying * MONTHLY_PRICE_USD).toFixed(2));

  // ── Funnel ratios from conversion_events ─────────────────────────
  const [signupEvents, firstClusterEvents, trialStartedEvents, subscribedEvents, reactivationSentEvents, reactivatedEvents, firstIngestEvents] = await Promise.all([
    fetchEvents("signup"),
    fetchEvents("first_cluster_built"),
    fetchEvents("trial_started"),
    fetchEvents("subscribed"),
    fetchEvents("reactivation_email_sent"),
    fetchEvents("reactivated"),
    fetchEvents("first_ingest_completed"),
  ]);

  // signup → first_cluster within 24h
  const signupByUser = new Map<string, string>();
  for (const e of signupEvents) signupByUser.set(e.user_id, e.occurred_at);

  let firstClusterWithin24h = 0;
  for (const e of firstClusterEvents) {
    const signupTs = signupByUser.get(e.user_id);
    if (!signupTs) continue;
    const dt = new Date(e.occurred_at).getTime() - new Date(signupTs).getTime();
    if (dt >= 0 && dt <= 24 * 60 * 60 * 1000) firstClusterWithin24h++;
  }
  const convFirstCluster24h =
    signupEvents.length > 0
      ? pct(firstClusterWithin24h / signupEvents.length)
      : null;

  // trial_started → subscribed
  const subscribedUserSet = new Set(subscribedEvents.map((e) => e.user_id));
  const trialsStartedTotal = trialStartedEvents.length;
  const trialsConverted = trialStartedEvents.filter((e) =>
    subscribedUserSet.has(e.user_id)
  ).length;
  const convTrialToPaid =
    trialsStartedTotal > 0 ? pct(trialsConverted / trialsStartedTotal) : null;

  // reactivation_email_sent → reactivated
  const reactivatedUserSet = new Set(reactivatedEvents.map((e) => e.user_id));
  const emailedTotal = reactivationSentEvents.length;
  const reactivatedAfterEmail = reactivationSentEvents.filter((e) =>
    reactivatedUserSet.has(e.user_id)
  ).length;
  const convReactivation =
    emailedTotal > 0 ? pct(reactivatedAfterEmail / emailedTotal) : null;

  // paid users who built a cluster within 1h of signup (≈ session 1)
  // (Proxy: first_cluster event within 1h of signup, then limited to
  // users who ended up paid.)
  const firstClusterByUser = new Map<string, string>();
  for (const e of firstClusterEvents) firstClusterByUser.set(e.user_id, e.occurred_at);

  let paidAndEarlyCluster = 0;
  for (const userId of subscribedUserSet) {
    const signup = signupByUser.get(userId);
    const cluster = firstClusterByUser.get(userId);
    if (!signup || !cluster) continue;
    const dt = new Date(cluster).getTime() - new Date(signup).getTime();
    if (dt >= 0 && dt <= 60 * 60 * 1000) paidAndEarlyCluster++;
  }
  const convPaidSession1Cluster =
    subscribedUserSet.size > 0
      ? pct(paidAndEarlyCluster / subscribedUserSet.size)
      : null;

  // ── Daily time series (last 30 days) ─────────────────────────────
  const daily = buildDailySeries(signupEvents, subscribedEvents, 30);

  // Intentionally unused metric kept for future (first ingest funnel).
  void firstIngestEvents;

  return {
    signups_total: signupsTotal ?? 0,
    trials_active: trialsActive ?? 0,
    trials_expired: trialsExpired ?? 0,
    paying_users: paying,
    mrr_usd: mrrUsd,
    conversion_signup_to_first_cluster_24h_pct: convFirstCluster24h,
    conversion_trial_to_paid_pct: convTrialToPaid,
    conversion_reactivation_pct: convReactivation,
    paid_users_who_clustered_in_session1_pct: convPaidSession1Cluster,
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

function pct(n: number): number {
  return Number((n * 100).toFixed(1));
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
