import { notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/shared/supabase/server";
import { isAdmin } from "@/shared/auth/with-auth";
import { getLaunchMetrics } from "@/lib/analytics/launch-metrics";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const user = await getUser();
  if (!isAdmin(user?.id)) notFound();

  const m = await getLaunchMetrics();

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-text-primary">
            Launch Analytics
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Funnel metrics for the $7.99/mo launch. Pulls from
            <code className="mx-1 rounded bg-white/[0.06] px-1 py-0.5 text-xs">
              conversion_events
            </code>
            and
            <code className="mx-1 rounded bg-white/[0.06] px-1 py-0.5 text-xs">
              profiles
            </code>
            .
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link
            href="/admin/health"
            className="rounded border border-white/[0.08] px-3 py-1.5 text-text-secondary hover:bg-white/[0.04]"
          >
            Health
          </Link>
          <Link
            href="/admin/review"
            className="rounded border border-white/[0.08] px-3 py-1.5 text-text-secondary hover:bg-white/[0.04]"
          >
            Review queue
          </Link>
        </nav>
      </header>

      {/* Top KPI row */}
      <section className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <Kpi label="Signups" value={m.signups_total} />
        <Kpi label="Trials active" value={m.trials_active} accent="sky" />
        <Kpi label="Trials expired" value={m.trials_expired} accent="amber" />
        <Kpi label="Paying users" value={m.paying_users} accent="emerald" />
        <Kpi
          label="MRR"
          value={`$${m.mrr_usd.toLocaleString()}`}
          accent="emerald"
        />
      </section>

      {/* Conversion ratios */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-text-primary mb-3">
          Conversion funnels
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Funnel
            label="Signup → first cluster in 24h"
            description="% of new signups who built a cluster within their first day."
            pct={m.conversion_signup_to_first_cluster_24h_pct}
          />
          <Funnel
            label="Trial → paid"
            description="% of trial_started users who ever subscribed."
            pct={m.conversion_trial_to_paid_pct}
          />
          <Funnel
            label="Expired → reactivated via email"
            description="% of users sent a reactivation email who then subscribed."
            pct={m.conversion_reactivation_pct}
          />
          <Funnel
            label="Paid users who built a cluster in session 1"
            description="% of paid users whose first cluster landed within 1h of signup."
            pct={m.paid_users_who_clustered_in_session1_pct}
          />
        </div>
      </section>

      {/* Daily series */}
      <section>
        <h2 className="text-sm font-medium text-text-primary mb-3">
          Last 30 days
        </h2>
        <div className="rounded-lg border border-white/[0.08] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02] text-xs uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Day</th>
                <th className="text-right px-3 py-2 font-medium">Signups</th>
                <th className="text-right px-3 py-2 font-medium">Subscribed</th>
              </tr>
            </thead>
            <tbody>
              {m.daily.map((row) => (
                <tr
                  key={row.day}
                  className="border-t border-white/[0.04] text-text-secondary"
                >
                  <td className="px-3 py-1.5 font-mono text-xs">{row.day}</td>
                  <td className="px-3 py-1.5 text-right">{row.signups}</td>
                  <td className="px-3 py-1.5 text-right">{row.subscribed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "sky" | "amber" | "emerald";
}) {
  const accentClass =
    accent === "sky"
      ? "text-sky-300"
      : accent === "amber"
      ? "text-amber-300"
      : accent === "emerald"
      ? "text-emerald-300"
      : "text-text-primary";
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-3">
      <div className="text-xs text-text-tertiary uppercase tracking-wide">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${accentClass}`}>
        {value}
      </div>
    </div>
  );
}

function Funnel({
  label,
  description,
  pct,
}: {
  label: string;
  description: string;
  pct: number | null;
}) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm text-text-primary">{label}</div>
        <div className="text-lg font-semibold text-text-primary">
          {pct === null ? "—" : `${pct.toFixed(1)}%`}
        </div>
      </div>
      <p className="mt-1 text-xs text-text-tertiary leading-relaxed">
        {description}
      </p>
    </div>
  );
}
