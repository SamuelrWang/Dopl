/**
 * C8 — the event row and webhook names (docs/specs/device-sdk/SPEC-v1.md › C8; P6, D5).
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

export const EVENT_OUTCOMES = ["ok", "error", "denied"] as const;
export const EventOutcomeSchema = z.enum(EVENT_OUTCOMES);
export type EventOutcome = z.infer<typeof EventOutcomeSchema>;

export const CONFIRMATION_RESULTS = ["approved", "denied", "timeout"] as const;

export const RouteDecisionSchema = z.object({
  /** What the caller asked for (`auto`, a kind, a device id). */
  target: z.string().min(1),
  /** Why the chosen device won (C5 routing step 4). */
  reason: z.string().min(1),
  /** Device ids considered. */
  candidates: z.array(z.string()),
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
});
export type DeviceEventRow = z.infer<typeof DeviceEventRowSchema>;

/** The spec's field list, in order (pinned by `events.test.ts`). */
export const EVENT_ROW_FIELDS = Object.keys(DeviceEventRowSchema.shape) as (keyof DeviceEventRow)[];

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
