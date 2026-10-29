/**
 * C8 webhook ENDPOINTS and DELIVERIES (ruled 2026-10-28, KB Plans/"Dopl SDK - Webhook Sender").
 *
 * Wire scheme: Standard Webhooks (`webhook-id` = `msg_<delivery id>`, stable across retries and
 * replays; `webhook-timestamp` per attempt; `webhook-signature: v1,<base64 HMAC-SHA256>` over
 * `${id}.${timestamp}.${body}`, one signature per live secret during a rotation). Body =
 * {@link WebhookEventEnvelopeSchema}. Retries: 5s, 5m, 30m, 2h, 5h, 10h, 10h; after
 * {@link WEBHOOK_MAX_ATTEMPTS} the delivery is `failed` (dead-letter) until replayed. Endpoints: https,
 * port 443 or 8443, public host. An attempt with no HTTP answer reports only an error class.
 */
import { z } from "zod";
import { ApiVersionSchema } from "./errors";
import { WebhookEventNameSchema } from "./events";

export const WEBHOOK_MAX_ATTEMPTS = 8;
export const WEBHOOK_ROTATION_OVERLAP_DEFAULT_S = 24 * 3600;
export const WEBHOOK_ROTATION_OVERLAP_MAX_S = 7 * 24 * 3600;
export const WEBHOOK_URL_MAX = 2048;
export const WEBHOOK_DESCRIPTION_MAX = 500;

/** The body of every webhook POST. Unknown `type`s and extra fields must be tolerated. */
export const WebhookEventEnvelopeSchema = z.object({
  /** `evt_<uuid>`: one per event, the same for every endpoint and every attempt. */
  id: z.string().regex(/^evt_[0-9a-f-]{36}$/),
  type: z.string(),
  /** The project's pinned API version when the event was sent out. */
  api_version: ApiVersionSchema.optional(),
  /** ISO 8601 time the event happened. */
  timestamp: z.iso.datetime({ offset: true }),
  livemode: z.boolean(),
  data: z.record(z.string(), z.unknown()),
});
export type WebhookEventEnvelope = z.infer<typeof WebhookEventEnvelopeSchema>;

const EnabledEventsSchema = z.array(WebhookEventNameSchema).min(1).max(50);

export const WebhookEndpointCreateRequestSchema = z.strictObject({
  url: z.string().min(1).max(WEBHOOK_URL_MAX),
  description: z.string().max(WEBHOOK_DESCRIPTION_MAX).nullable().optional(),
  /** Omit or `null` = every event, including types added later. */
  enabled_events: EnabledEventsSchema.nullable().optional(),
});
export type WebhookEndpointCreateRequest = z.infer<typeof WebhookEndpointCreateRequestSchema>;

export const WebhookEndpointUpdateRequestSchema = z
  .strictObject({
    url: z.string().min(1).max(WEBHOOK_URL_MAX).optional(),
    description: z.string().max(WEBHOOK_DESCRIPTION_MAX).nullable().optional(),
    enabled_events: EnabledEventsSchema.nullable().optional(),
    /** `true` stops new deliveries (pending ones are dead-lettered); `false` resumes. */
    disabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "at least one field is required" });
export type WebhookEndpointUpdateRequest = z.infer<typeof WebhookEndpointUpdateRequestSchema>;

export const WebhookSecretRotateRequestSchema = z.strictObject({
  /** How long the old secret keeps signing alongside the new one. 0 = drop it now. */
  overlap_seconds: z.number().int().min(0).max(WEBHOOK_ROTATION_OVERLAP_MAX_S).default(WEBHOOK_ROTATION_OVERLAP_DEFAULT_S),
});
export type WebhookSecretRotateRequest = z.infer<typeof WebhookSecretRotateRequestSchema>;

export const WEBHOOK_ENDPOINT_STATUSES = ["enabled", "disabled"] as const;

export const WebhookEndpointSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  description: z.string().nullable(),
  enabled_events: z.array(WebhookEventNameSchema).nullable(),
  status: z.enum(WEBHOOK_ENDPOINT_STATUSES),
  livemode: z.boolean(),
  /** While a rotated-out secret still signs: when it stops. */
  previous_secret_expires_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;

/** Create and rotate answers: the only times the secret is ever shown. */
export const WebhookEndpointWithSecretSchema = WebhookEndpointSchema.extend({
  secret: z.string().regex(/^whsec_[A-Za-z0-9+/]+={0,2}$/),
});
export type WebhookEndpointWithSecret = z.infer<typeof WebhookEndpointWithSecretSchema>;

export const WEBHOOK_DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;

export const WebhookAttemptSchema = z.object({
  attempt: z.number().int().min(1),
  attempted_at: z.iso.datetime({ offset: true }),
  /** `null` = no HTTP response (connect error, timeout, refused address). */
  status_code: z.number().int().nullable(),
  error: z.string().nullable(),
  duration_ms: z.number().int().min(0),
  /** First 1 KiB of the response body. */
  response_body: z.string().nullable(),
});
export type WebhookAttempt = z.infer<typeof WebhookAttemptSchema>;

export const WebhookDeliverySchema = z.object({
  id: z.uuid(),
  endpoint_id: z.uuid(),
  /** The `webhook-id` header this delivery is sent with. */
  message_id: z.string().regex(/^msg_[0-9a-f-]{36}$/),
  event_id: z.string().regex(/^evt_[0-9a-f-]{36}$/),
  event_type: WebhookEventNameSchema,
  status: z.enum(WEBHOOK_DELIVERY_STATUSES),
  /** Tries in the current run (a replay resets it). */
  attempt_count: z.number().int().min(0),
  /** Set only while `pending`. */
  next_attempt_at: z.iso.datetime({ offset: true }).nullable(),
  last_status_code: z.number().int().nullable(),
  last_error: z.string().nullable(),
  delivered_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  /** Every HTTP attempt, newest first. Present on `GET /webhook_deliveries/{id}` only. */
  attempts: z.array(WebhookAttemptSchema).optional(),
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
