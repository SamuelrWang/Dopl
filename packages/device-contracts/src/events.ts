/**
 * C8 — the event row and webhook names (spec v1 › C8; P6, D5).
 *
 * ONE row per SDK, REST or MCP call, from day one (analytics cannot be backfilled). Fields are the
 * spec's list in the spec's order; the two compound spec names are split into columns:
 * `profile_id@version` → `profile_id` + `profile_version`, `bytes_in/out` → `bytes_in` + `bytes_out`.
 * `cost_units` is collected now although pricing is held (D5).
 */
import { z } from "zod";

import { ActionStatusSchema, DeliverIntentSchema } from "./actions";
import { CapabilityIdSchema, DeviceKindSchema, RiskTierSchema } from "./capabilities";
import { CONNECT_WEBHOOK_EVENTS } from "./connect";
import { ErrorCodeSchema } from "./errors";
import { EnvironmentSchema } from "./keys";
import { listResponseSchema } from "./lists";

export const EVENT_OUTCOMES = ["ok", "error", "denied"] as const;
export const EventOutcomeSchema = z.enum(EVENT_OUTCOMES);
export type EventOutcome = z.infer<typeof EventOutcomeSchema>;

export const CONFIRMATION_RESULTS = ["approved", "denied", "timeout"] as const;

/** One device's verdict from the router, kept so a log can show why each was or was not picked. */
export const CONSIDERED_VERDICTS = ["chosen", "eligible", "skipped"] as const;
export const ConsideredDeviceSchema = z.object({
  device_id: z.string().min(1),
  kind: DeviceKindSchema,
  verdict: z.enum(CONSIDERED_VERDICTS),
  /** Why it was skipped, or why it was picked. */
  reason: z.string().min(1),
});
export type ConsideredDevice = z.infer<typeof ConsideredDeviceSchema>;

export const RouteDecisionSchema = z.object({
  /** What the caller asked for (`auto`, a kind, a device id). */
  target: z.string().min(1),
  /** Why the chosen device won (C5 routing step 4). */
  reason: z.string().min(1),
  /** Device ids considered. */
  candidates: z.array(z.string()),
  /** The router's verdict per device. Absent on rows written before 2026-10-31 and on calls that never routed. */
  considered: z.array(ConsideredDeviceSchema).optional(),
});
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

export const EventConfirmationSchema = z.object({
  required: z.boolean(),
  /** Null when not required or still pending. */
  result: z.enum(CONFIRMATION_RESULTS).nullable(),
});

export const EventLatencySchema = z.object({
  api: z.number().nonnegative(),
  device_delivery: z.number().nonnegative().nullable(),
  user_response: z.number().nonnegative().nullable(),
});

export const DeviceEventRowSchema = z.object({
  event_id: z.string().min(1),
  ts: z.iso.datetime(),
  org_id: z.string().min(1),
  project_id: z.string().min(1),
  env: EnvironmentSchema,
  external_user_id: z.string().nullable(),
  connection_id: z.string().nullable(),
  device_id: z.string().nullable(),
  device_kind: DeviceKindSchema.nullable(),
  vendor: z.string().nullable(),
  model: z.string().nullable(),
  firmware: z.string().nullable(),
  adapter_version: z.string().nullable(),
  capability: CapabilityIdSchema.nullable(),
  intent: DeliverIntentSchema.nullable(),
  route_decision: RouteDecisionSchema.nullable(),
  profile_id: z.string().nullable(),
  profile_version: z.number().int().positive().nullable(),
  risk_tier: RiskTierSchema.nullable(),
  confirmation: EventConfirmationSchema.nullable(),
  outcome: EventOutcomeSchema,
  error_code: ErrorCodeSchema.nullable(),
  latency_ms: EventLatencySchema,
  bytes_in: z.number().int().nonnegative(),
  bytes_out: z.number().int().nonnegative(),
  cost_units: z.number().nonnegative(),
  /** The key behind the call; null for rows no key made (hosted Connect, the prosumer fallback). */
  api_key_id: z.string().nullish(),
  /** The `dev_actions` row this call created or moved. */
  action_id: z.string().nullish(),
  /** Stable name of the call (`deliver`, `device.action`, `connect.pair`, `notify.prosumer_fallback`). */
  operation: z.string().nullish(),
  http_method: z.string().nullish(),
  /** The request path. Never holds a token: hosted Connect writes `:token`. */
  route: z.string().nullish(),
  http_status: z.number().int().nullish(),
});
export type DeviceEventRow = z.infer<typeof DeviceEventRowSchema>;

/** The spec's field list, in order (pinned by `events.test.ts`). */
export const EVENT_ROW_FIELDS = Object.keys(DeviceEventRowSchema.shape) as (keyof DeviceEventRow)[];

/**
 * The PUBLIC event (`GET /events`, ruled 2026-10-28): the C8 row a developer may read back about
 * their own calls. A curated subset, not the row: `org_id` (internal tenancy), `bytes_in`,
 * `bytes_out` and `cost_units` (metering, pricing held by D5) stay server-side. Everything kept
 * names the developer's own objects (`external_user_id` is THEIR id for the user, never a Dopl one)
 * or explains the call (route, profile, tier, outcome, latency).
 */
export const PublicDeviceEventSchema = DeviceEventRowSchema.pick({
  event_id: true,
  ts: true,
  project_id: true,
  env: true,
  external_user_id: true,
  connection_id: true,
  device_id: true,
  device_kind: true,
  vendor: true,
  model: true,
  firmware: true,
  adapter_version: true,
  capability: true,
  intent: true,
  route_decision: true,
  profile_id: true,
  profile_version: true,
  risk_tier: true,
  confirmation: true,
  outcome: true,
  error_code: true,
  latency_ms: true,
});
export type PublicDeviceEvent = z.infer<typeof PublicDeviceEventSchema>;

/** The C8 fields `PublicDeviceEventSchema` never exposes (pinned by `events.test.ts`). */
export const PRIVATE_EVENT_FIELDS = ["org_id", "bytes_in", "bytes_out", "cost_units", "api_key_id", "action_id", "operation", "http_method", "route", "http_status"] as const;

/** `GET /events` response: the shared list envelope (`lists.ts`). */
export const EventListResponseSchema = listResponseSchema(PublicDeviceEventSchema);
export type EventListResponse = z.infer<typeof EventListResponseSchema>;

/** A row → its public shape (drops the private fields; never copies an unknown one). */
export function toPublicDeviceEvent(row: DeviceEventRow): PublicDeviceEvent {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(PublicDeviceEventSchema.shape)) out[key] = row[key as keyof DeviceEventRow];
  return out as PublicDeviceEvent;
}

/** Every webhook event name (C2 + C8). Signed, retried, replayable (P1). */
export const WEBHOOK_EVENT_NAMES = [
  ...CONNECT_WEBHOOK_EVENTS,
  "action.completed",
  "action.failed",
  "ask.answered",
  "input.utterance",
] as const;
export const WebhookEventNameSchema = z.enum(WEBHOOK_EVENT_NAMES);
export type WebhookEventName = z.infer<typeof WebhookEventNameSchema>;

/** Re-stated for webhook consumers: an `action.*` payload carries the action's terminal status. */
export const ActionWebhookStatusSchema = ActionStatusSchema.extract(["done", "failed"]);
