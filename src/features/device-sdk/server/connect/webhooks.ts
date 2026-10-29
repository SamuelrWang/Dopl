import { randomUUID } from "node:crypto";
import { WebhookEventNameSchema, type WebhookEventName } from "../../types";
import { buildEnvelope } from "../webhooks/envelope";
import type { ConnectStore, Tenant } from "./store-types";

/**
 * `enqueueWebhookEvent` — write ONE `dev_webhook_outbox` row (C8). The sender
 * (`webhooks/sender.ts`) fans it out to the project's endpoints, signs and retries; nothing here
 * sends anything. The event name is checked against the frozen `WEBHOOK_EVENT_NAMES` so a typo
 * fails loudly here instead of at the SQL CHECK.
 *
 * Payload = the webhook body (`webhooks/envelope.ts`): `{ id, type, timestamp, livemode, data }`,
 * `data` being the event's object (a `Connection` for `connection.*`, an `Action` for `action.*`).
 * The row id is chosen here so the body's `id` (`evt_<row id>`) is known before the insert.
 */
export async function enqueueWebhookEvent(
  store: Pick<ConnectStore, "insertOutbox">,
  tenant: Tenant,
  type: WebhookEventName,
  data: Record<string, unknown>,
  now: Date = new Date()
): Promise<void> {
  const event = WebhookEventNameSchema.parse(type);
  const id = randomUUID();
  await store.insertOutbox({
    id,
    project_id: tenant.projectId,
    env: tenant.env,
    event_type: event,
    payload: { ...buildEnvelope({ outboxId: id, type: event, env: tenant.env, data, now }) },
  });
}
