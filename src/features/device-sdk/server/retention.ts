import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { DEFAULT_EVENT_RETENTION_DAYS } from "./events";

/** ⚠ Ids go in the URL, and past about 350 UUIDs production's gateway answers with headers `fetch` refuses to read. */
const BATCH = 200;
/** At most this many rows per table in one run, so a backlog clears over days instead of holding the database. */
const MAX_BATCHES = 50;

const cutoffOf = (days: number, now: Date) => new Date(now.getTime() - days * 86_400_000).toISOString();

interface OldRows {
  table: string;
  id?: string;
  time?: string;
  cutoff: string;
  /** PostgREST `or` filter narrowing which old rows may go. */
  only?: string;
}

async function deleteInBatches({ table, id = "id", time = "created_at", cutoff, only }: OldRows): Promise<number> {
  const db = supabaseAdmin();
  let deleted = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const old = db.from(table).select(id).lt(time, cutoff);
    const { data, error } = await (only ? old.or(only) : old).limit(BATCH);
    if (error) throw new Error(`prune ${table} failed: ${error.message}`);
    const ids = ((data ?? []) as unknown as Array<Record<string, string>>).map((r) => r[id]);
    if (ids.length === 0) break;
    const gone = await db.from(table).delete({ count: "exact" }).in(id, ids);
    if (gone.error) throw new Error(`prune ${table} failed: ${gone.error.message}`);
    deleted += gone.count ?? 0;
    if (ids.length < BATCH) break;
  }
  return deleted;
}

/** Delete events older than the retention window, in bounded batches. Throws on a database error; the cron route reports it. */
export async function pruneDevEvents(options: { retentionDays?: number; now?: Date } = {}): Promise<number> {
  const cutoff = cutoffOf(options.retentionDays ?? DEFAULT_EVENT_RETENTION_DAYS, options.now ?? new Date());
  return deleteInBatches({ table: "dev_events", id: "event_id", time: "ts", cutoff });
}

/**
 * 🔒 docs/legal/PRIVACY.md PROMISES 30 DAYS for device message logs. `dev_events` goes above.
 * The text also sits in `dev_device_messages` (the queued message), `dev_actions` (an answer's label, an error's
 * message) and the webhook tables (the event body, and the start of the developer's reply), so those go too.
 * A message a device can still take, or an event still to fan out, is left. Nothing queued lives near 30 days, so
 * a pending message past its expiry goes: a device that stopped polling never marks it expired.
 * Deleting an outbox row cascades to its deliveries and their attempts.
 */
export async function pruneDeviceText(options: { retentionDays?: number; now?: Date } = {}): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const cutoff = cutoffOf(options.retentionDays ?? DEFAULT_EVENT_RETENTION_DAYS, now);
  const [messages, actions, outbox] = await Promise.all([
    deleteInBatches({ table: "dev_device_messages", cutoff, only: `status.neq.pending,expires_at.lt."${now.toISOString()}"` }),
    deleteInBatches({ table: "dev_actions", cutoff }),
    deleteInBatches({ table: "dev_webhook_outbox", cutoff, only: "status.neq.pending" }),
  ]);
  return { dev_device_messages: messages, dev_actions: actions, dev_webhook_outbox: outbox };
}

/**
 * The demo rows (`5eed0000-`, docs/specs/dev-portal-live/seed.sql) move forward by whole days before the prune, so it
 * never reaches them. Touches only that prefix, and does nothing once they are removed. Never fails the prune.
 */
export async function rollSeedRows(): Promise<void> {
  const { error } = await supabaseAdmin().rpc("dev_portal_roll_seed");
  if (error) console.warn(`[device-sdk] seed roll failed: ${error.message}`);
}
