import { notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/shared/supabase/server";
import { isAdmin } from "@/shared/auth/with-auth";
import {
  getRecentAlerts,
  getExternalApiHealth,
  getIngestionHealth,
  getMcpHealth,
  computeOverallStatus,
} from "@/features/analytics/server/health";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  yellow: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  red: "bg-red-500/15 text-red-300 ring-red-400/30",
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-white/5 text-text-tertiary",
  warn: "bg-amber-500/10 text-amber-300",
  error: "bg-red-500/10 text-red-300",
  critical: "bg-red-500/25 text-red-200 ring-1 ring-red-400/40",
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function AdminHealthPage() {
  const user = await getUser();
  if (!isAdmin(user?.id)) notFound();

  const [alerts, external, ingestion, mcp] = await Promise.all([
    getRecentAlerts({ sinceMs: 24 * 60 * 60 * 1000, limit: 50 }),
    getExternalApiHealth(),
    getIngestionHealth(),
    getMcpHealth(),
  ]);

  const status = computeOverallStatus({ alerts, ingestion, mcp, external });

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-text-primary">System Health</h1>
          <p className="text-sm text-text-secondary mt-1">
            Rolling 24h view of anomalies, external API failures, and ingestion success rate.
          </p>
        </div>
        <Link
          href="/admin/review"
          className="text-sm text-text-secondary hover:text-text-primary underline underline-offset-2"
        >
          Moderation queue →
        </Link>
      </header>

      {/* Status banner */}
      <div
        className={`rounded-xl px-5 py-4 ring-1 mb-6 flex items-center justify-between ${STATUS_STYLES[status.level]}`}
      >
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-current" />
          <div>
            <div className="text-sm font-medium uppercase tracking-wide">{status.level}</div>
            <div className="text-xs opacity-80">{status.reason}</div>
          </div>
        </div>
        <div className="text-xs opacity-80">
          {alerts.length} alert{alerts.length === 1 ? "" : "s"} in the last 24h
        </div>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4">
          <div className="text-xs uppercase tracking-wide text-text-tertiary mb-1">Ingestion (24h)</div>
          <div className="text-2xl font-medium text-text-primary">
            {(ingestion.success_rate * 100).toFixed(0)}%
          </div>
          <div className="text-xs text-text-secondary mt-2 space-y-0.5">
            <div>{ingestion.completed_24h} completed</div>
            <div className="text-red-300">{ingestion.failed_24h} failed{ingestion.timeouts_24h > 0 && ` (${ingestion.timeouts_24h} timeouts)`}</div>
            <div className="text-amber-300">{ingestion.empty_content_24h} empty/blocked</div>
          </div>
        </div>

        <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4">
          <div className="text-xs uppercase tracking-wide text-text-tertiary mb-1">MCP (24h)</div>
          <div className="text-2xl font-medium text-text-primary">
            {mcp.calls_24h === 0 ? "—" : `${((1 - mcp.error_rate) * 100).toFixed(0)}%`}
          </div>
          <div className="text-xs text-text-secondary mt-2 space-y-0.5">
            <div>{mcp.calls_24h} calls</div>
            <div className="text-red-300">{mcp.errors_24h} errors</div>
            {mcp.p95_latency_ms !== null && <div>p95 latency: {mcp.p95_latency_ms}ms</div>}
          </div>
        </div>

        <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4">
          <div className="text-xs uppercase tracking-wide text-text-tertiary mb-1">Unacked alerts</div>
          <div className="text-2xl font-medium text-text-primary">{alerts.length}</div>
          <div className="text-xs text-text-secondary mt-2">
            {alerts.filter((a) => a.severity === "critical").length} critical,{" "}
            {alerts.filter((a) => a.severity === "error").length} error,{" "}
            {alerts.filter((a) => a.severity === "warn").length} warn
          </div>
        </div>
      </div>

      {/* External API health */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-3">External APIs (24h)</h2>
        {external.length === 0 ? (
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 text-sm text-text-tertiary">
            No external API events logged in the last 24h. (Either nothing ran, or everything ran clean.)
          </div>
        ) : (
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-tertiary">
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left px-4 py-2">Provider</th>
                  <th className="text-right px-4 py-2">Events</th>
                  <th className="text-right px-4 py-2">Errors</th>
                  <th className="text-right px-4 py-2">Critical</th>
                  <th className="text-left px-4 py-2">Last error</th>
                </tr>
              </thead>
              <tbody>
                {external.map((p) => (
                  <tr key={p.name} className="border-t border-white/[0.04]">
                    <td className="px-4 py-2 font-mono text-text-primary">{p.name}</td>
                    <td className="px-4 py-2 text-right text-text-secondary">{p.events_24h}</td>
                    <td className={`px-4 py-2 text-right ${p.errors_24h > 0 ? "text-red-300" : "text-text-tertiary"}`}>
                      {p.errors_24h}
                    </td>
                    <td className={`px-4 py-2 text-right ${p.criticals_24h > 0 ? "text-red-200 font-medium" : "text-text-tertiary"}`}>
                      {p.criticals_24h}
                    </td>
                    <td className="px-4 py-2 text-text-tertiary text-xs max-w-md truncate">
                      {p.last_error_message ? (
                        <span title={p.last_error_message}>
                          {p.last_error_message} <span className="opacity-60">· {formatRelative(p.last_error_at)}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Alert list */}
      <section>
        <h2 className="text-lg font-medium text-text-primary mb-3">Recent alerts</h2>
        {alerts.length === 0 ? (
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 text-sm text-text-tertiary">
            No alerts in the last 24h.
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <div
                key={a.fingerprint}
                className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4 space-y-1.5"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wide ${SEVERITY_STYLES[a.severity]}`}
                  >
                    {a.severity}
                  </span>
                  <span className="text-xs text-text-tertiary">{a.category}</span>
                  <span className="text-xs text-text-tertiary">·</span>
                  <span className="text-xs text-text-secondary font-mono">{a.source}</span>
                  <span className="text-xs text-text-tertiary ml-auto">
                    ×{a.count} · last seen {formatRelative(a.last_seen)}
                  </span>
                </div>
                <div className="text-sm text-text-primary break-words">{a.sample_message}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
