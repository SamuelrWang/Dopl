import crypto from "crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Health/anomaly signal logger. Anything abnormal — external API failures,
 * ingestion errors, 5xx, quota breaches, slow requests — drops a row into
 * `system_events`, which `/admin/health` aggregates into rolling error rates
 * and alert groupings.
 *
 * Fire-and-forget: never throws, never blocks the caller.
 */

export type SystemEventSeverity = "info" | "warn" | "error" | "critical";

export type SystemEventCategory =
  | "ingestion"
  | "external_api"
  | "db"
  | "auth"
  | "billing"
  | "quota"
  | "perf"
  | "other";

export interface SystemEventInput {
  severity: SystemEventSeverity;
  category: SystemEventCategory;
  source: string; // endpoint or module identifier, e.g. "POST /api/ingest" or "anthropic.messages"
  message: string; // human-readable summary, one line
  /** Tokens hashed into a grouping fingerprint; same fingerprint = "same
   * incident" for rollup. ⚠ Only tokens STABLE across occurrences (error name,
   * external API name, pipeline step) — never per-request IDs. Omitted falls
   * back to `[category, source, message]`. */
  fingerprintKeys?: string[];
  metadata?: Record<string, unknown>;
  userId?: string | null;
}

const MAX_METADATA_CHARS = 4_000;

function truncate(value: unknown): unknown {
  if (value == null) return value;
  try {
    const str = JSON.stringify(value);
    if (str.length <= MAX_METADATA_CHARS) return value;
    return { _truncated: true, _length: str.length, preview: str.slice(0, MAX_METADATA_CHARS) };
  } catch {
    return { _unserializable: true };
  }
}

function computeFingerprint(event: SystemEventInput): string {
  const parts = event.fingerprintKeys?.length
    ? event.fingerprintKeys
    : [event.category, event.source, event.message];
  return crypto
    .createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 32);
}

export async function logSystemEvent(event: SystemEventInput): Promise<void> {
  try {
    const supabase = supabaseAdmin();
    await supabase.from("system_events").insert({
      severity: event.severity,
      category: event.category,
      source: event.source,
      message: event.message.slice(0, 500),
      fingerprint: computeFingerprint(event),
      metadata: event.metadata ? truncate(event.metadata) : null,
      user_id: event.userId ?? null,
    });
  } catch {
    // Never break the caller.
  }
}
