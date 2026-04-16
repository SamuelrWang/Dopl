import { supabaseAdmin } from "@/lib/supabase";

/**
 * Admin health dashboard aggregation.
 *
 * All queries run on-demand when the admin loads /admin/health. No cron,
 * no stored alert state — derive everything from raw system_events,
 * mcp_events, and entries. Thresholds live in code so they're easy to
 * tweak.
 */

export interface AlertGroup {
  fingerprint: string;
  severity: "info" | "warn" | "error" | "critical";
  category: string;
  source: string;
  sample_message: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

export interface ExternalApiHealth {
  name: string;
  events_24h: number;
  errors_24h: number;
  criticals_24h: number;
  last_error_message: string | null;
  last_error_at: string | null;
}

export interface IngestionHealth {
  completed_24h: number;
  failed_24h: number;
  timeouts_24h: number;
  empty_content_24h: number;
  success_rate: number; // 0..1; 1 if no attempts
}

export interface McpHealth {
  calls_24h: number;
  errors_24h: number;
  error_rate: number;
  p95_latency_ms: number | null;
}

export interface OverallStatus {
  level: "green" | "yellow" | "red";
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

/**
 * Group recent system_events by fingerprint. Sort newest-first by last_seen.
 * Returns only severities >= warn (unless `includeInfo` is true).
 */
export async function getRecentAlerts(opts?: {
  sinceMs?: number;
  includeInfo?: boolean;
  limit?: number;
}): Promise<AlertGroup[]> {
  const sinceMs = opts?.sinceMs ?? DAY_MS;
  const since = iso(sinceMs);
  const limit = opts?.limit ?? 50;

  const severities = opts?.includeInfo
    ? ["info", "warn", "error", "critical"]
    : ["warn", "error", "critical"];

  const db = supabaseAdmin();
  const { data } = await db
    .from("system_events")
    .select("fingerprint, severity, category, source, message, created_at")
    .gte("created_at", since)
    .in("severity", severities)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (!data || data.length === 0) return [];

  // Group by fingerprint. Keep the most severe seen and the newest sample.
  const severityRank = { info: 0, warn: 1, error: 2, critical: 3 };
  const groups = new Map<string, AlertGroup>();

  for (const row of data) {
    const existing = groups.get(row.fingerprint);
    if (!existing) {
      groups.set(row.fingerprint, {
        fingerprint: row.fingerprint,
        severity: row.severity,
        category: row.category,
        source: row.source,
        sample_message: row.message,
        count: 1,
        first_seen: row.created_at,
        last_seen: row.created_at,
      });
      continue;
    }
    existing.count += 1;
    if (row.created_at > existing.last_seen) {
      existing.last_seen = row.created_at;
      existing.sample_message = row.message;
    }
    if (row.created_at < existing.first_seen) {
      existing.first_seen = row.created_at;
    }
    if (severityRank[row.severity as keyof typeof severityRank] > severityRank[existing.severity]) {
      existing.severity = row.severity;
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => {
      const rankDiff = severityRank[b.severity] - severityRank[a.severity];
      if (rankDiff !== 0) return rankDiff;
      return b.last_seen.localeCompare(a.last_seen);
    })
    .slice(0, limit);
}

/**
 * Success/error/latency stats per external API, last 24h.
 * Sources are expected to use dotted prefixes like "anthropic.messages" —
 * we split on `.` to get the provider name.
 */
export async function getExternalApiHealth(): Promise<ExternalApiHealth[]> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("system_events")
    .select("source, severity, message, created_at, category")
    .gte("created_at", iso(DAY_MS))
    .in("category", ["external_api", "quota", "auth", "perf"])
    .order("created_at", { ascending: false })
    .limit(5000);

  if (!data) return [];

  const byProvider = new Map<string, ExternalApiHealth>();
  for (const row of data) {
    const provider = (row.source || "unknown").split(/[.\[]/)[0];
    let entry = byProvider.get(provider);
    if (!entry) {
      entry = {
        name: provider,
        events_24h: 0,
        errors_24h: 0,
        criticals_24h: 0,
        last_error_message: null,
        last_error_at: null,
      };
      byProvider.set(provider, entry);
    }
    entry.events_24h += 1;
    if (row.severity === "error" || row.severity === "critical") {
      entry.errors_24h += 1;
      if (row.severity === "critical") entry.criticals_24h += 1;
      if (!entry.last_error_at || row.created_at > entry.last_error_at) {
        entry.last_error_at = row.created_at;
        entry.last_error_message = row.message;
      }
    }
  }

  return Array.from(byProvider.values()).sort(
    (a, b) => b.errors_24h - a.errors_24h || b.events_24h - a.events_24h
  );
}

/**
 * Ingestion success rate + failure breakdown over the last 24h.
 * Uses system_events (for failures, since failed entries are deleted)
 * and entries (for successes — rows that reached complete status).
 */
export async function getIngestionHealth(): Promise<IngestionHealth> {
  const db = supabaseAdmin();
  const since = iso(DAY_MS);

  const [completedRes, eventsRes] = await Promise.all([
    db
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("status", "complete")
      .gte("ingested_at", since),
    db
      .from("system_events")
      .select("fingerprint, metadata")
      .eq("category", "ingestion")
      .gte("created_at", since)
      .in("severity", ["warn", "error", "critical"])
      .limit(5000),
  ]);

  const completed = completedRes.count ?? 0;
  let failed = 0;
  let timeouts = 0;
  let empty = 0;

  for (const row of eventsRes.data || []) {
    const meta = (row.metadata || {}) as { timed_out?: boolean };
    if (row.fingerprint && meta.timed_out) timeouts += 1;
    // "empty_content" events are warns; don't count as hard failures, but track separately
    if (typeof row.fingerprint === "string") {
      // Guess: events with timed_out:true or from runPipeline are hard failures
      if (meta.timed_out !== undefined || row.fingerprint) {
        // Use metadata presence of 'entry_id' and severity to decide; here use source via another lookup
      }
    }
  }

  // More direct: re-fetch with source/severity to partition cleanly.
  const { data: partitioned } = await db
    .from("system_events")
    .select("source, severity, metadata")
    .eq("category", "ingestion")
    .gte("created_at", since)
    .limit(5000);

  failed = 0;
  timeouts = 0;
  empty = 0;
  for (const row of partitioned || []) {
    if (row.source === "pipeline.runPipeline" && (row.severity === "error" || row.severity === "critical")) {
      failed += 1;
      if ((row.metadata as { timed_out?: boolean })?.timed_out) timeouts += 1;
    } else if (row.source === "pipeline.contentCheck") {
      empty += 1;
    }
  }

  const attempts = completed + failed + empty;
  const success_rate = attempts === 0 ? 1 : completed / attempts;

  return { completed_24h: completed, failed_24h: failed, timeouts_24h: timeouts, empty_content_24h: empty, success_rate };
}

/**
 * MCP call health from the existing mcp_events table.
 */
export async function getMcpHealth(): Promise<McpHealth> {
  const db = supabaseAdmin();
  const since = iso(DAY_MS);

  const { data } = await db
    .from("mcp_events")
    .select("response_status, latency_ms")
    .eq("source", "mcp")
    .gte("created_at", since)
    .limit(10000);

  if (!data || data.length === 0) {
    return { calls_24h: 0, errors_24h: 0, error_rate: 0, p95_latency_ms: null };
  }

  const errors = data.filter((r) => (r.response_status ?? 0) >= 400).length;
  const latencies = data
    .map((r) => r.latency_ms)
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);

  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : null;

  return {
    calls_24h: data.length,
    errors_24h: errors,
    error_rate: errors / data.length,
    p95_latency_ms: p95,
  };
}

/**
 * Roll up into a top-line red/yellow/green signal.
 */
export function computeOverallStatus(inputs: {
  alerts: AlertGroup[];
  ingestion: IngestionHealth;
  mcp: McpHealth;
  external: ExternalApiHealth[];
}): OverallStatus {
  // Red: any critical alert, auth failure against an external API, or
  // ingestion success rate below 50% with non-trivial volume.
  const hasCritical = inputs.alerts.some((a) => a.severity === "critical");
  const externalAuthFailed = inputs.external.some((p) => p.criticals_24h > 0);
  const ingestionTanking =
    inputs.ingestion.completed_24h + inputs.ingestion.failed_24h >= 5 &&
    inputs.ingestion.success_rate < 0.5;

  if (hasCritical || externalAuthFailed || ingestionTanking) {
    return {
      level: "red",
      reason: hasCritical
        ? "Critical alert active"
        : externalAuthFailed
          ? "External API auth failing"
          : "Ingestion success rate < 50%",
    };
  }

  // Yellow: warn/error alerts, elevated MCP error rate, or >20% ingestion failures
  const hasErrors = inputs.alerts.some((a) => a.severity === "error");
  const mcpElevated = inputs.mcp.calls_24h > 10 && inputs.mcp.error_rate > 0.2;
  const ingestionDegraded =
    inputs.ingestion.completed_24h + inputs.ingestion.failed_24h >= 5 &&
    inputs.ingestion.success_rate < 0.8;

  if (hasErrors || mcpElevated || ingestionDegraded) {
    return {
      level: "yellow",
      reason: hasErrors
        ? "Errors logged in last 24h"
        : mcpElevated
          ? "Elevated MCP error rate"
          : "Ingestion degraded",
    };
  }

  return { level: "green", reason: "All clear in the last 24h" };
}
