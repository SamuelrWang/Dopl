import { WebhookEventNameSchema, type WebhookEventName } from "../../types";
import type { ConnectStore, Tenant } from "./store-types";

/**
 * `enqueueWebhookEvent` — write ONE `dev_webhook_outbox` row (C8). Delivery (signing, retries,
 * replay) is P1 and reads these rows; nothing here sends anything. The event name is checked against
 * the frozen `WEBHOOK_EVENT_NAMES` so a typo fails loudly here instead of at the SQL CHECK.
 *
 * Payload envelope: `{ type, created_at, data }`, `data` being the event's object (a `Connection`
 * for `connection.*`).
 */
export async function enqueueWebhookEvent(
  store: Pick<ConnectStore, "insertOutbox">,
  tenant: Tenant,
  type: WebhookEventName,
  data: Record<string, unknown>,
  now: Date = new Date()
): Promise<void> {
  const event = WebhookEventNameSchema.parse(type);
  await store.insertOutbox({
    project_id: tenant.projectId,
    env: tenant.env,
    event_type: event,
    payload: { type: event, created_at: now.toISOString(), data },
  });
}
