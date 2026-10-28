/**
 * C5 — device context and routing profiles (docs/specs/device-sdk/SPEC-v1.md › C5; D3).
 *
 * 🔒 **D3: DOPL NEVER REWRITES CONTENT.** A profile passes guidance to the developer's agent
 * (`prompt_append`, `output`) and Dopl only ENFORCES limits — `overflow` is `truncate`, a
 * `send_to` another device kind, or a `callback`. There is no `rewrite`/`summarize` option, and
 * the profile is a strict object so one cannot ride in as an extra key.
 */
import { z } from "zod";

import { CapabilityIdSchema, CapabilityScopeSchema, DeviceKindSchema, RiskTierSchema } from "./capabilities";

export const POSTURES = ["glanceable", "hands_free", "seated", "driving", "unknown"] as const;
export const PostureSchema = z.enum(POSTURES);
export type Posture = z.infer<typeof PostureSchema>;

export const OUTPUT_FORMATS = ["plain", "markdown", "blocks"] as const;
export const OutputFormatSchema = z.enum(OUTPUT_FORMATS);

export const ProfileOutputSchema = z.strictObject({
  max_lines: z.number().int().positive().optional(),
  max_chars: z.number().int().positive().optional(),
  format: OutputFormatSchema.optional(),
  markdown: z.boolean().optional(),
});
export type ProfileOutput = z.infer<typeof ProfileOutputSchema>;

/** Which devices a profile applies to: by kind, model or posture (at least one). */
export const ProfileMatchSchema = z
  .strictObject({
    kind: DeviceKindSchema.optional(),
    model: z.string().min(1).optional(),
    posture: PostureSchema.optional(),
  })
  .refine((m) => m.kind !== undefined || m.model !== undefined || m.posture !== undefined, {
    message: "match needs kind, model or posture",
  });
export type ProfileMatch = z.infer<typeof ProfileMatchSchema>;

/** How a tier's actions are confirmed under this profile. */
export const CONFIRMATION_MODES = ["none", "on_device", "trusted_surface", "deny"] as const;
export const ConfirmationModeSchema = z.enum(CONFIRMATION_MODES);
export type ConfirmationMode = z.infer<typeof ConfirmationModeSchema>;

export const ProfileConfirmationSchema = z
  .partialRecord(RiskTierSchema, ConfirmationModeSchema)
  .refine((c) => c.T4 !== "none", { message: "T4 actions are confirmed on every call (C7); `none` is not allowed" });
export type ProfileConfirmation = z.infer<typeof ProfileConfirmationSchema>;

/** D3: the ONLY overflow behaviours. Never a rewrite. */
export const ProfileOverflowSchema = z.union([
  z.literal("truncate"),
  z.literal("callback"),
  z.strictObject({ send_to: DeviceKindSchema }),
]);
export type ProfileOverflow = z.infer<typeof ProfileOverflowSchema>;

export const ContextProfileSchema = z.strictObject({
  id: z.string().min(1),
  /** Server-assigned on save; events record `profile_id` + `profile_version`. */
  version: z.number().int().positive().optional(),
  match: ProfileMatchSchema,
  prompt_append: z.string(),
  output: ProfileOutputSchema,
  allowed_capabilities: z.array(CapabilityScopeSchema),
  display_template: z.string().min(1).optional(),
  confirmation: ProfileConfirmationSchema.optional(),
  overflow: ProfileOverflowSchema,
});
export type ContextProfile = z.infer<typeof ContextProfileSchema>;

/** The profile slice the context object carries. */
export const ContextProfileRefSchema = z.object({
  id: z.string().min(1),
  prompt_append: z.string(),
  output: ProfileOutputSchema,
});

export const ActiveDeviceSchema = z.object({
  id: z.string().min(1),
  kind: DeviceKindSchema,
  model: z.string(),
  last_seen_s: z.number().nonnegative(),
});

export const AvailableDeviceSchema = z.object({
  kind: DeviceKindSchema,
  id: z.string().min(1),
  capabilities: z.array(CapabilityIdSchema),
});

/** `GET /v1/users/{external_user_id}/context`; also injected into MCP tool results. */
export const DeviceContextSchema = z.object({
  active_device: ActiveDeviceSchema.nullable(),
  posture: PostureSchema,
  available: z.array(AvailableDeviceSchema),
  profile: ContextProfileRefSchema.nullable(),
  source_of_last_message: DeviceKindSchema.nullable(),
});
export type DeviceContext = z.infer<typeof DeviceContextSchema>;
