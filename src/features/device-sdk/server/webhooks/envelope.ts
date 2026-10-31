import type { Environment, WebhookEventName } from "../../types";

/**
 * The webhook BODY (ruled 2026-10-28, KB Plans/"Dopl SDK - Webhook Sender" §payload):
 *
 *   { id: "evt_<outbox uuid>", type, api_version, timestamp, livemode, data }
 *
 * `type` / `timestamp` / `data` are the Standard Webhooks fields `@dopl/sdk` `unwrap` reads; `id`,
 * `api_version` and `livemode` are additive. `api_version` is stamped at fan-out (SQL
 * `dev_webhook_fan_out`) from the project's pinned version, so it is frozen before the first send.
 * Consumers must ignore unknown `type`s and fields.
 */
interface WebhookEnvelope {
  id: string;
  type: WebhookEventName;
  api_version?: string;
  timestamp: string;
  livemode: boolean;
  data: Record<string, unknown>;
}

export const webhookEventId = (outboxId: string): string => `evt_${outboxId}`;

export function buildEnvelope(input: {
  outboxId: string;
  type: WebhookEventName;
  env: Environment;
  data: Record<string, unknown>;
  now: Date;
}): WebhookEnvelope {
  return {
    id: webhookEventId(input.outboxId),
    type: input.type,
    timestamp: input.now.toISOString(),
    livemode: input.env === "live",
    data: input.data,
  };
}
