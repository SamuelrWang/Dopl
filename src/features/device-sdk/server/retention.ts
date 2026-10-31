import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { DEFAULT_EVENT_RETENTION_DAYS } from "./events";

/**
 * 🔒 docs/legal/PRIVACY.md PROMISES 30 DAYS for device message logs. `dev_events` is pruned by `events.ts`.
 * The text also sits in `dev_device_messages` (the queued message), `dev_actions` (an answer's label, an error's
 * message) and the webhook tables (the event body, and the start of the developer's reply), so those go too.
 * A delivery still pending is left: the longest retry schedule is about 27 hours, far inside the window.
 * Deleting an outbox row cascades to its deliveries and their attempts.
 */
export async function pruneDeviceText(options: { retentionDays?: number; now?: Date } = {}): Promise<Record<string, number>> {
  const days = options.retentionDays ?? DEFAULT_EVENT_RETENTION_DAYS;
  const cutoff = new Date((options.now ?? new Date()).getTime() - days * 86_400_000).toISOString();
  const db = supabaseAdmin();
  const [messages, actions, outbox] = await Promise.all([
    db.from("dev_device_messages").delete({ count: "exact" }).lt("created_at", cutoff).neq("status", "pending"),
    db.from("dev_actions").delete({ count: "exact" }).lt("created_at", cutoff),
    db.from("dev_webhook_outbox").delete({ count: "exact" }).lt("created_at", cutoff).neq("status", "pending"),
  ]);
  for (const res of [messages, actions, outbox]) if (res.error) throw new Error(`pruneDeviceText failed: ${res.error.message}`);
  return { dev_device_messages: messages.count ?? 0, dev_actions: actions.count ?? 0, dev_webhook_outbox: outbox.count ?? 0 };
}
