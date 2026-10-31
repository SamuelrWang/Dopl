import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { DEFAULT_EVENT_RETENTION_DAYS } from "./events";

const BATCH = 500;
/** At most this many rows per table in one run, so a backlog clears over days instead of holding the database. */
const MAX_BATCHES = 20;

type Rows = { lt: (column: string, value: string) => Rows; limit: (n: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

async function deleteInBatches(table: string, cutoff: string, narrow: (rows: Rows) => Rows = (rows) => rows): Promise<number> {
  const db = supabaseAdmin();
  let deleted = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const old = await narrow(db.from(table).select("id") as unknown as Rows).lt("created_at", cutoff).limit(BATCH);
    if (old.error) throw new Error(`pruneDeviceText failed: ${old.error.message}`);
    const ids = ((old.data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) break;
    const gone = await db.from(table).delete({ count: "exact" }).in("id", ids);
    if (gone.error) throw new Error(`pruneDeviceText failed: ${gone.error.message}`);
    deleted += gone.count ?? 0;
    if (ids.length < BATCH) break;
  }
  return deleted;
}

/**
 * 🔒 docs/legal/PRIVACY.md PROMISES 30 DAYS for device message logs. `dev_events` is pruned by `events.ts`.
 * The text also sits in `dev_device_messages` (the queued message), `dev_actions` (an answer's label, an error's
 * message) and the webhook tables (the event body, and the start of the developer's reply), so those go too.
 * A message a device can still take, or an event still to fan out, is left. Nothing queued lives near 30 days, so
 * a pending message past its expiry goes: a device that stopped polling never marks it expired.
 * Deleting an outbox row cascades to its deliveries and their attempts.
 */
export async function pruneDeviceText(options: { retentionDays?: number; now?: Date } = {}): Promise<Record<string, number>> {
  const days = options.retentionDays ?? DEFAULT_EVENT_RETENTION_DAYS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const [messages, actions, outbox] = await Promise.all([
    deleteInBatches("dev_device_messages", cutoff, (rows) => (rows as unknown as { or: (filter: string) => Rows }).or(`status.neq.pending,expires_at.lt."${now.toISOString()}"`)),
    deleteInBatches("dev_actions", cutoff),
    deleteInBatches("dev_webhook_outbox", cutoff, (rows) => (rows as unknown as { neq: (column: string, value: string) => Rows }).neq("status", "pending")),
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
