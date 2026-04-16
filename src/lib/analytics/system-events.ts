import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Health/anomaly signal logger.
 *
 * Anything abnormal across the stack — external API failures, ingestion
 * errors, 5xx responses, quota breaches, slow requests — drops a row into
 * `system_events`. The admin `/admin/health` dashboard aggregates these
 * into rolling error rates and alert groupings.
 *
 * Fire-and-forget: never throws, never blocks the caller. Analytics
 * failures must not break the user-facing request.
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
  /** Stable tokens used to hash a grouping fingerprint. Rows with the same
   * fingerprint are the "same incident" for rollup purposes. Include only
   * tokens that are stable across occurrences (error name, external API
   * name, pipeline step) — NOT per-request IDs. If omitted, falls back to
   * `[category, source, message]` which groups reasonably in most cases. */
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
