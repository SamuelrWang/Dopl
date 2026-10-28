/**
 * C3 — the device-agnostic capability model (spec v1 › C3, C7).
 *
 * Every device publishes capability descriptors; agents call capabilities, never vendor APIs.
 * Every capability has exactly one DEFAULT risk tier (`CAPABILITY_RISK_TIER`), which the policy
 * engine (C7) starts from. Frozen v1: a new id or a tier change is a maintainer ruling + changelog line.
 */
import { z } from "zod";

/** §2 object model › Device.kind. Closed for v1. */
export const DEVICE_KINDS = [
  "glasses",
  "phone",
  "desktop",
  "watch",
  "home_hub",
  "home_device",
  "vehicle",
  "robot",
] as const;
export const DeviceKindSchema = z.enum(DEVICE_KINDS);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

/** C7 risk tiers: T0 read · T1 present · T2 ambient sensing · T3 reversible actuation · T4 safety-critical. */
export const RISK_TIERS = ["T0", "T1", "T2", "T3", "T4"] as const;
export const RiskTierSchema = z.enum(RISK_TIERS);
export type RiskTier = z.infer<typeof RiskTierSchema>;

/** C7 default policy per tier, before project config and end-user grants narrow it. */
export const RISK_TIER_DEFAULT_POLICY = {
  T0: "allow",
  T1: "allow",
  T2: "explicit_grant",
  T3: "allow_confirm_configurable",
  T4: "confirm_every_call",
} as const satisfies Record<RiskTier, string>;

export const CAPABILITY_FAMILIES = ["state", "present", "ask", "capture", "input", "act", "act.motion"] as const;
export const CapabilityFamilySchema = z.enum(CAPABILITY_FAMILIES);
export type CapabilityFamily = z.infer<typeof CapabilityFamilySchema>;

/** Every capability id → its family. `telemetry.*` and `presence.*` belong to `state`. */
export const CAPABILITY_FAMILY = {
  "state.read": "state",
  "telemetry.read": "state",
  "presence.read": "state",
  "present.notify": "present",
  "present.display": "present",
  "present.speak": "present",
  "present.haptic": "present",
  "ask.choice": "ask",
  "ask.confirm": "ask",
  "ask.text": "ask",
  "capture.photo": "capture",
  "capture.audio": "capture",
  "capture.video_stream": "capture",
  "capture.screen": "capture",
  "input.utterance": "input",
  "input.tap": "input",
  "input.gesture": "input",
  "input.button": "input",
  "act.set": "act",
  "act.media": "act",
  "act.navigate": "act",
  "act.lock": "act",
  "act.motion.move": "act.motion",
  "act.motion.gripper": "act.motion",
  "act.motion.vehicle": "act.motion",
} as const satisfies Record<string, CapabilityFamily>;

export type CapabilityId = keyof typeof CAPABILITY_FAMILY;
export const CAPABILITY_IDS = Object.keys(CAPABILITY_FAMILY) as [CapabilityId, ...CapabilityId[]];
export const CapabilityIdSchema = z.enum(CAPABILITY_IDS);

/** C3 table: the default tier per capability. `act` splits T3 (reversible) / T4 (locks); motion is T4. */
export const CAPABILITY_RISK_TIER = {
  "state.read": "T0",
  "telemetry.read": "T0",
  "presence.read": "T0",
  "present.notify": "T1",
  "present.display": "T1",
  "present.speak": "T1",
  "present.haptic": "T1",
  "ask.choice": "T1",
  "ask.confirm": "T1",
  "ask.text": "T1",
  "capture.photo": "T2",
  "capture.audio": "T2",
  "capture.video_stream": "T2",
  "capture.screen": "T2",
  "input.utterance": "T1",
  "input.tap": "T1",
  "input.gesture": "T1",
  "input.button": "T1",
  "act.set": "T3",
  "act.media": "T3",
  "act.navigate": "T3",
  "act.lock": "T4",
  "act.motion.move": "T4",
  "act.motion.gripper": "T4",
  "act.motion.vehicle": "T4",
} as const satisfies Record<CapabilityId, RiskTier>;

/**
 * A grantable / allow-listable capability scope: one capability id, or a whole family as
 * `<family>.*` (`present.*`, `act.motion.*`). Used by C2 `requested_scopes`, C7 grants and
 * C5 `allowed_capabilities`.
 */
export const CapabilityScopeSchema = z.union([
  CapabilityIdSchema,
  z.templateLiteral([CapabilityFamilySchema, ".*"]),
]);
export type CapabilityScope = z.infer<typeof CapabilityScopeSchema>;

/** How fast a capability answers; drives routing and SDK timeouts. */
export const LATENCY_CLASSES = ["realtime", "interactive", "deferred"] as const;
export const LatencyClassSchema = z.enum(LATENCY_CLASSES);
export type LatencyClass = z.infer<typeof LatencyClassSchema>;

/** `<adapter_id>@<version>`, e.g. `even_g2@0.3`. */
export const ADAPTER_REF_RE = /^[a-z0-9_]+@[0-9][0-9A-Za-z.+-]*$/;
export const AdapterRefSchema = z.string().regex(ADAPTER_REF_RE);

/** Per-capability limits; open keys (each kind has its own), scalar values. */
export const CapabilityLimitsSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));
export type CapabilityLimits = z.infer<typeof CapabilityLimitsSchema>;

/** The documented limit keys of `present.display` (C3 example). */
export const PresentDisplayLimitsSchema = z.object({
  width_px: z.number().int().positive(),
  height_px: z.number().int().positive(),
  max_blocks: z.number().int().positive(),
  max_text_bytes: z.number().int().positive(),
  charset: z.string(),
  color: z.string(),
});
export type PresentDisplayLimits = z.infer<typeof PresentDisplayLimitsSchema>;

export const CapabilityDescriptorSchema = z.object({
  capability: CapabilityIdSchema,
  limits: CapabilityLimitsSchema,
  latency_class: LatencyClassSchema,
  risk_tier: RiskTierSchema,
  since_adapter: AdapterRefSchema,
});
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;

/** One user's device as the API returns it (`GET /v1/devices/{id}`, C2 exchange). */
export const DeviceSchema = z.object({
  id: z.string().min(1),
  kind: DeviceKindSchema,
  vendor: z.string(),
  model: z.string(),
  firmware: z.string().nullable(),
  adapter_id: z.string().min(1),
  adapter_version: z.string().min(1),
  capabilities: z.array(CapabilityDescriptorSchema),
  online: z.boolean(),
  /** ISO 8601. */
  last_seen_at: z.iso.datetime().nullable(),
});
export type Device = z.infer<typeof DeviceSchema>;
