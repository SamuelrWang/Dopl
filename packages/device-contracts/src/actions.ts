/**
 * C4 — the Actions API (spec v1 › C4; D4).
 *
 * Two levels, picked per call: intent-level `deliver` (Dopl routes via C5) and device-level
 * `actions/{capability}`. Every action is async and idempotent; T4 actions pass through
 * `needs_confirmation` (C7). `show` / `ask` / `notify` are SDK helper methods over `deliver`, not routes.
 */
import { z } from "zod";

import { CapabilityIdSchema, DeviceKindSchema } from "./capabilities";
import { ChoiceOptionSchema, DisplayBlocksSchema } from "./display";
import { ErrorBodySchema } from "./errors";

export const DELIVER_INTENTS = ["message", "ask", "notify", "display"] as const;
export const DeliverIntentSchema = z.enum(DELIVER_INTENTS);
export type DeliverIntent = z.infer<typeof DeliverIntentSchema>;

export const URGENCIES = ["low", "normal", "high"] as const;
export const UrgencySchema = z.enum(URGENCIES);
export type Urgency = z.infer<typeof UrgencySchema>;

export const ACTION_STATUSES = ["queued", "delivered", "done", "failed", "needs_confirmation"] as const;
export const ActionStatusSchema = z.enum(ACTION_STATUSES);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

/** `ask.*` actions hold for up to this long (as `glasses_ask` does today). */
export const ASK_HOLD_MAX_S = 200;

export const IdempotencyKeySchema = z.string().min(1).max(255);

/** `"auto"`, a device kind, or a device id. */
export const DeliverTargetSchema = z.union([z.literal("auto"), DeviceKindSchema, z.string().min(1)]);
export type DeliverTarget = "auto" | z.infer<typeof DeviceKindSchema> | (string & {});

export const DeliverContentSchema = z
  .object({
    text: z.string().min(1).optional(),
    blocks: DisplayBlocksSchema.optional(),
    options: z.array(ChoiceOptionSchema).min(2).optional(),
  })
  .refine((c) => c.text !== undefined || c.blocks !== undefined || c.options !== undefined, {
    message: "content needs text, blocks or options",
  });
export type DeliverContent = z.infer<typeof DeliverContentSchema>;

/** `POST /v1/users/{external_user_id}/deliver`. */
export const DeliverRequestSchema = z.object({
  intent: DeliverIntentSchema,
  content: DeliverContentSchema,
  urgency: UrgencySchema,
  target: DeliverTargetSchema.optional(),
  profile: z.string().min(1).optional(),
  idempotency_key: IdempotencyKeySchema,
});
export type DeliverRequest = z.infer<typeof DeliverRequestSchema>;

export const RoutedToSchema = z.object({
  device_id: z.string().min(1),
  kind: DeviceKindSchema,
  reason: z.string().min(1),
});
export type RoutedTo = z.infer<typeof RoutedToSchema>;

export const DeliverResponseSchema = z.object({
  delivery_id: z.string().min(1),
  routed_to: RoutedToSchema,
  status: ActionStatusSchema,
});
export type DeliverResponse = z.infer<typeof DeliverResponseSchema>;

/** `POST /v1/devices/{device_id}/actions/{capability}`. */
export const DeviceActionRequestSchema = z.object({
  args: z.record(z.string(), z.unknown()),
  idempotency_key: IdempotencyKeySchema,
});
export type DeviceActionRequest = z.infer<typeof DeviceActionRequestSchema>;

export const DeviceActionResponseSchema = z.object({
  action_id: z.string().min(1),
  status: ActionStatusSchema,
});
export type DeviceActionResponse = z.infer<typeof DeviceActionResponseSchema>;

/** `GET /v1/actions/{id}` — the poll; the same object rides the `action.completed` / `action.failed` webhooks. */
export const ActionSchema = z.object({
  action_id: z.string().min(1),
  device_id: z.string().min(1),
  capability: CapabilityIdSchema,
  status: ActionStatusSchema,
  /** Capability-specific output (an `ask.*` answer, a photo URL…); null until `done`. */
  result: z.record(z.string(), z.unknown()).nullable(),
  /** Set when `failed`. */
  error: ErrorBodySchema.nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type Action = z.infer<typeof ActionSchema>;
