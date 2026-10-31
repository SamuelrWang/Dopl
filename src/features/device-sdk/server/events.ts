import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { DeviceEventRowSchema, type DeviceEventRow } from "../types";
import { createColumnCompat } from "./column-compat";

/**
 * DEVICE SDK EVENT LOG (C8, A2) — `logDevEvent(row)` writes one `dev_events` row.
 *
 * ⚠ FIRE-AND-FORGET AND NEVER THROWS. Analytics must never fail a developer's call: an invalid row
 * is dropped with a `console.warn`, a failed write with a `console.error`, and nothing propagates.
 *
 * BATCHED: rows queue in memory and flush as ONE insert when the queue reaches `MAX_BATCH`, when the
 * short coalescing timer fires (UNREF'D, so it never keeps a Node process alive), or when a caller
 * awaits `flushDevEvents()` (`withDeveloperKey` does so in Next's `after()`, so a serverless
 * function is not frozen with rows still queued).
 *
 * The sink is injectable (`setDevEventSinkForTests`); the default inserts with the service role.
 *
 * 🔒 HOT PATH (docs/INVARIANTS.md §12): one unknown column would lose the WHOLE batch, so the default
 * sink drops the portal's columns (`20261124100000_dev_portal_log_fields.sql`) and retries when the
 * database does not have them yet. The row survives without them.
 */

export const DEV_EVENTS_TABLE = "dev_events";
/** Rows per insert. */
export const MAX_BATCH = 100;
/** Coalescing window before a partial batch flushes on its own. */
export const FLUSH_DELAY_MS = 50;
/** Default retention for request logs (C8: "retained per plan"; no plan column exists yet). */
export const DEFAULT_EVENT_RETENTION_DAYS = 30;

export interface DevEventSink {
  write(rows: DeviceEventRow[]): Promise<void>;
}

const logColumns = createColumnCompat(["api_key_id", "action_id", "operation", "http_method", "route", "http_status", "message_text", "channel_id", "message_id"]);

/** The batch insert, over any `insert`. Exported so the suite runs the real path against a database lacking the columns. */
export async function writeEventRows(
  insert: (rows: DeviceEventRow[]) => PromiseLike<{ error: { message: string } | null }>,
  rows: DeviceEventRow[],
  compat = logColumns
): Promise<void> {
  const first = await insert(rows.map((r) => compat.shape(r)));
  if (!first.error) return;
  if (!compat.isMissing(first.error)) throw new Error(first.error.message);
  const second = await insert(rows.map((r) => compat.fallback(r)));
  if (second.error) throw new Error(second.error.message);
}

const supabaseSink: DevEventSink = {
  write: (rows) => writeEventRows((batch) => supabaseAdmin().from(DEV_EVENTS_TABLE).insert(batch), rows),
};

let sink: DevEventSink = supabaseSink;
let queue: DeviceEventRow[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const inFlight = new Set<Promise<void>>();

/** Test seam: route writes to `next` (or back to Supabase with `null`). Clears the queue. */
export function setDevEventSinkForTests(next: DevEventSink | null): void {
  sink = next ?? supabaseSink;
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}

/** The fields a caller must supply; everything else in C8 defaults to null / zero. */
export type DevEventInput = Pick<DeviceEventRow, "org_id" | "project_id" | "env" | "outcome"> &
  Partial<Omit<DeviceEventRow, "latency_ms">> & {
    latency_ms?: Partial<DeviceEventRow["latency_ms"]>;
  };

/** A full C8 row from the required fields, with a fresh `event_id` and `ts`. Pure. */
export function buildDevEvent(input: DevEventInput): DeviceEventRow {
  return {
    event_id: input.event_id ?? randomUUID(),
    ts: input.ts ?? new Date().toISOString(),
    org_id: input.org_id,
    project_id: input.project_id,
    env: input.env,
    external_user_id: input.external_user_id ?? null,
    connection_id: input.connection_id ?? null,
    device_id: input.device_id ?? null,
    device_kind: input.device_kind ?? null,
    vendor: input.vendor ?? null,
    model: input.model ?? null,
    firmware: input.firmware ?? null,
    adapter_version: input.adapter_version ?? null,
    capability: input.capability ?? null,
    intent: input.intent ?? null,
    route_decision: input.route_decision ?? null,
    profile_id: input.profile_id ?? null,
    profile_version: input.profile_version ?? null,
    risk_tier: input.risk_tier ?? null,
    confirmation: input.confirmation ?? null,
    outcome: input.outcome,
    error_code: input.error_code ?? null,
    latency_ms: {
      api: input.latency_ms?.api ?? 0,
      device_delivery: input.latency_ms?.device_delivery ?? null,
      user_response: input.latency_ms?.user_response ?? null,
    },
    bytes_in: input.bytes_in ?? 0,
    bytes_out: input.bytes_out ?? 0,
    cost_units: input.cost_units ?? 0,
    api_key_id: input.api_key_id ?? null,
    action_id: input.action_id ?? null,
    operation: input.operation ?? null,
    http_method: input.http_method ?? null,
    route: input.route ?? null,
    http_status: input.http_status ?? null,
    message_text: input.message_text ?? null,
    channel_id: input.channel_id ?? null,
    message_id: input.message_id ?? null,
  };
}

/** Queue one event. Validated against the C8 schema; never throws, never awaits. */
export function logDevEvent(input: DevEventInput): void {
  try {
    const parsed = DeviceEventRowSchema.safeParse(buildDevEvent(input));
    if (!parsed.success) {
      const where = parsed.error.issues.map((i) => i.path.join(".") || "(row)").join(", ");
      console.warn(`[device-sdk] dropped invalid dev_events row (${where})`);
      return;
    }
    queue.push(parsed.data);
    if (queue.length >= MAX_BATCH) {
      void flushDevEvents();
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        void flushDevEvents();
      }, FLUSH_DELAY_MS);
      // Never keep a process (a test runner, a script, a lambda) alive for analytics.
      if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
    }
  } catch (err) {
    console.warn("[device-sdk] logDevEvent failed:", err);
  }
}

/** Write everything queued and wait for every in-flight write. Never rejects. */
export function flushDevEvents(): Promise<void> {
  try {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_BATCH);
      const write = Promise.resolve()
        .then(() => sink.write(batch))
        .catch((err: unknown) => {
          console.error(`[device-sdk] dev_events write failed (${batch.length} rows dropped):`, err);
        })
        .finally(() => inFlight.delete(write));
      inFlight.add(write);
    }
    return Promise.all([...inFlight]).then(
      () => undefined,
      () => undefined
    );
  } catch (err) {
    console.error("[device-sdk] flushDevEvents failed:", err);
    return Promise.resolve();
  }
}

/**
 * Delete events older than the retention window. Returns the count deleted. Throws on a database
 * error (the cron route reports it); this is NOT on any request path.
 */
export async function pruneDevEvents(
  options: { retentionDays?: number; now?: Date } = {}
): Promise<number> {
  const days = options.retentionDays ?? DEFAULT_EVENT_RETENTION_DAYS;
  const cutoff = new Date((options.now ?? new Date()).getTime() - days * 86_400_000).toISOString();
  const { count, error } = await supabaseAdmin()
    .from(DEV_EVENTS_TABLE)
    .delete({ count: "exact" })
    .lt("ts", cutoff);
  if (error) throw new Error(`pruneDevEvents failed: ${error.message}`);
  return count ?? 0;
}
