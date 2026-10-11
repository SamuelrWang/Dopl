import { notFound } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { isAdmin } from "@/shared/auth/with-auth";
import {
  getRecentAlerts,
  getServerErrorsByRoute,
  getMcpHealth,
  computeOverallStatus,
} from "@/features/analytics/server/health";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  yellow: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  red: "bg-red-500/15 text-red-300 ring-red-400/30",
};

/**
 * ⚠ The tooltip behind every "(at least)" below. One sentence, because the
 * reader's question is only ever "is this number real?".
 */
const FLOOR_HINT =
  "Computed over a server-clipped read (supabase/config.toml max_rows), so the real figure is this or higher.";

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-surface-raised-2 text-text-tertiary",
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

  const [alertScan, routeScan, mcp] = await Promise.all([
    getRecentAlerts({ sinceMs: 24 * 60 * 60 * 1000, limit: 50 }),
    getServerErrorsByRoute(),
    getMcpHealth(),
  ]);

  // ⚠ `mcp` is NOT an input: nothing live measures an MCP error, so the banner's
  // old "elevated MCP error rate" arm was deleted rather than left reading 0.
  const status = computeOverallStatus({
    alerts: alertScan,
    routes: routeScan,
  });

  // 🔒 **A FLOOR MUST NOT RENDER AS A FIGURE (Samuel #2935).** Every number on
  // this page is a group-by, and until the aggregate RPCs are applied they are
  // computed over at most `max_rows` (1,000) events. The banner below says so
  // once, and each clipped section marks its own totals — the old page said
  // nothing anywhere, which is how `×1,000` read as a real count.
  const alerts = alertScan.rows;
  const routes = routeScan.rows;
  const floorMark = (clipped: boolean) =>
    clipped ? <span title={FLOOR_HINT} className="opacity-60"> (at least)</span> : null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-text-primary">System Health</h1>
          <p className="text-sm text-text-secondary mt-1">
            Rolling 24h view of anomalies, server errors by route, and MCP call volume.
          </p>
        </div>
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

      {/* 🔒 THE CLIP, STATED ONCE AND IN FULL. Without this the page cannot be
          told apart from an accurate one. */}
      {status.truncated && (
        <div className="rounded-xl bg-amber-500/10 text-amber-200 ring-1 ring-amber-400/30 px-5 py-3 mb-6 text-xs space-y-1">
          <div className="font-medium uppercase tracking-wide">
            These counts are floors, not totals
          </div>
          <div className="opacity-90">
            {FLOOR_HINT} Affected:{" "}
            {/* ⚠ MCP is absent on purpose: it is a COUNT now, and `max_rows`
                cannot clip a count. */}
            {[
              alertScan.truncated && "alerts",
              routeScan.truncated && "server errors by route",
            ]
              .filter(Boolean)
              .join(", ")}
            . The per-group aggregate RPCs remove the ceiling once their
            migration is applied.
          </div>
        </div>
      )}

      {/* Metric tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="rounded-xl bg-surface-raised-1 border border-border-default p-4">
          <div className="text-xs uppercase tracking-wide text-text-tertiary mb-1">
            MCP calls (24h)
          </div>
          <div className="text-2xl font-medium text-text-primary">
            {mcp.calls_24h.toLocaleString()}
          </div>
          {/* 🔒 **ONE NUMBER, AND THE TILE SAYS WHY (2026-10-10).** This tile
              showed a success RATE, an error count and a p95 off `mcp_events` —
              a table with no writer since 2026-07-17, so all three read zero for
              three months. The live table carries no status and no latency, so
              they were DELETED rather than faked. The count itself is exact:
              `max_rows` bounds a response body, never a count. */}
          <div className="text-xs text-text-secondary mt-2">
            Volume only. Error rate and latency are not instrumented.
          </div>
        </div>

        <div className="rounded-xl bg-surface-raised-1 border border-border-default p-4">
          <div className="text-xs uppercase tracking-wide text-text-tertiary mb-1">Unacked alerts</div>
          <div className="text-2xl font-medium text-text-primary">
            {alerts.length}
            {alertScan.truncated && (
              <span className="text-sm opacity-60" title={FLOOR_HINT}>
                +
              </span>
            )}
          </div>
          <div className="text-xs text-text-secondary mt-2">
            {alerts.filter((a) => a.severity === "critical").length} critical,{" "}
            {alerts.filter((a) => a.severity === "error").length} error,{" "}
            {alerts.filter((a) => a.severity === "warn").length} warn
            {floorMark(alertScan.truncated)}
          </div>
        </div>
      </div>

      {/* 🔒 **"Server errors by route", NOT "External APIs" (2026-10-10).** This
          section read `category IN ('external_api','quota','auth','perf')` and
          keyed on a dotted provider prefix. Measured: those categories hold ZERO
          rows over 30 days, and the logger writes HTTP routes, not providers. So
          it was structurally blank. It is now named after the rows it actually
          has. Provider-level instrumentation does not exist yet and is tracked
          as separate work — naming a panel after data nobody writes is what kept
          that gap invisible. */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-3">
          Server errors by route (24h)
        </h2>
        {routes.length === 0 ? (
          <div className="rounded-xl bg-surface-raised-1 border border-border-subtle p-4 text-sm text-text-tertiary">
            No server errors logged in the last 24h.
          </div>
        ) : (
          <div className="rounded-xl bg-surface-raised-1 border border-border-default overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-tertiary">
                <tr className="border-b border-border-subtle">
                  {/* ⚠ Ids are normalised out of the path, so one failing route
                      is one row rather than one row per channel. */}
                  <th className="text-left px-4 py-2">Route</th>
                  <th className="text-right px-4 py-2">Errors</th>
                  <th className="text-right px-4 py-2">Critical</th>
                  <th className="text-left px-4 py-2">Last error</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.route} className="border-t border-border-subtle">
                    <td className="px-4 py-2 font-mono text-text-primary">{r.route}</td>
                    <td className={`px-4 py-2 text-right ${r.errors_24h > 0 ? "text-red-300" : "text-text-tertiary"}`}>
                      {r.errors_24h}
                      {floorMark(routeScan.truncated)}
                    </td>
                    <td className={`px-4 py-2 text-right ${r.criticals_24h > 0 ? "text-red-200 font-medium" : "text-text-tertiary"}`}>
                      {r.criticals_24h}
                      {floorMark(routeScan.truncated)}
                    </td>
                    <td className="px-4 py-2 text-text-tertiary text-xs max-w-md truncate">
                      {r.last_error_message ? (
                        <span title={r.last_error_message}>
                          {r.last_error_message} <span className="opacity-60">· {formatRelative(r.last_error_at)}</span>
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
          <div className="rounded-xl bg-surface-raised-1 border border-border-subtle p-4 text-sm text-text-tertiary">
            No alerts in the last 24h.
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <div
                key={a.fingerprint}
                className="rounded-xl bg-surface-raised-1 border border-border-default p-4 space-y-1.5"
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
                    ×{a.count}
                    {floorMark(alertScan.truncated)} · last seen{" "}
                    {formatRelative(a.last_seen)}
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
