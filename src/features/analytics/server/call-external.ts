import { logSystemEvent } from "./system-events";

/**
 * Wrap an outbound call to a third-party service so failures, latency
 * spikes, and quota/rate-limit errors flow into the system_events table.
 *
 * Usage:
 *   const reply = await callExternal(
 *     "anthropic.messages",
 *     () => claude.messages.create({...}),
 *     { userId, entryId }
 *   );
 *
 * Behavior:
 *   - On success: if latency > slowMs threshold, logs a 'warn' perf event.
 *   - On throw: logs an 'error' (or 'critical' for quota/auth) event and
 *     rethrows so the caller's existing error handling is unchanged.
 *   - Never swallows the error. Fire-and-forget logging.
 */

export interface CallExternalContext {
  userId?: string | null;
  entryId?: string | null;
  /** Requests exceeding this many ms log a 'warn' perf event. Default 15s. */
  slowMs?: number;
  /** Extra metadata to attach to the logged event. */
  metadata?: Record<string, unknown>;
}

const DEFAULT_SLOW_MS = 15_000;

/** Classify an error to guide severity and fingerprinting. */
function classifyError(err: unknown): {
  name: string;
  severity: "error" | "critical";
  category: "external_api" | "quota" | "auth";
  statusCode?: number;
} {
  const e = err as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
    message?: string;
    type?: string;
  };
  const status = e?.status ?? e?.statusCode;
  const code = (e?.code || e?.type || e?.name || "UnknownError").toString();
  const msg = (e?.message || "").toLowerCase();

  // Quota / billing / credits exhausted on the external side
  if (
    status === 402 ||
    code === "insufficient_quota" ||
    msg.includes("quota") ||
    msg.includes("billing") ||
    msg.includes("insufficient")
  ) {
    return { name: "quota_exceeded", severity: "critical", category: "quota", statusCode: status };
  }

  // Rate limit — warn/error but grouped as external_api
  if (status === 429 || code === "rate_limit_error" || msg.includes("rate limit")) {
    return { name: "rate_limited", severity: "error", category: "external_api", statusCode: status };
  }

  // Auth error against the external service — almost always a config/key issue, critical
  if (status === 401 || status === 403 || code === "authentication_error") {
    return { name: "auth_failed", severity: "critical", category: "auth", statusCode: status };
  }

  // Server-side error on the external side
  if (status && status >= 500) {
    return { name: `server_${status}`, severity: "error", category: "external_api", statusCode: status };
  }

  // Timeout / network
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED" || msg.includes("timeout")) {
    return { name: code || "timeout", severity: "error", category: "external_api", statusCode: status };
  }

  // Fallback
  return { name: code, severity: "error", category: "external_api", statusCode: status };
}

export async function callExternal<T>(
  externalApi: string,
  fn: () => Promise<T>,
  ctx: CallExternalContext = {}
): Promise<T> {
  const started = Date.now();
  const slowMs = ctx.slowMs ?? DEFAULT_SLOW_MS;

  try {
    const result = await fn();
    const latency = Date.now() - started;
    if (latency > slowMs) {
      void logSystemEvent({
        severity: "warn",
        category: "perf",
        source: externalApi,
        message: `Slow external call: ${externalApi} took ${latency}ms`,
        fingerprintKeys: ["perf", externalApi, "slow"],
        metadata: { latency_ms: latency, external_api: externalApi, ...ctx.metadata },
        userId: ctx.userId ?? null,
      });
    }
    return result;
  } catch (err) {
    const latency = Date.now() - started;
    const cls = classifyError(err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    void logSystemEvent({
      severity: cls.severity,
      category: cls.category,
      source: externalApi,
      message: `${externalApi} failed: ${errorMessage}`.slice(0, 500),
      fingerprintKeys: [cls.category, externalApi, cls.name],
      metadata: {
        external_api: externalApi,
        error_name: cls.name,
        status_code: cls.statusCode,
        latency_ms: latency,
        entry_id: ctx.entryId ?? null,
        ...ctx.metadata,
      },
      userId: ctx.userId ?? null,
    });
    throw err;
  }
}
