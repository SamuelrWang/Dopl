/**
 * C9 — the adapter contract (internal, Dopl-maintained; docs/specs/device-sdk/SPEC-v1.md › C9; D6).
 *
 * Generalises `src/features/glasses/platforms/types.ts › GlassesPlatform` (one `even_g2` entry today)
 * beyond glasses. Adapters are versioned; the version lands in every event row (C8). D6: an adapter
 * built on a reverse-engineered protocol is `experimental: true` and is not offered to paying
 * customers by default.
 */
import { z } from "zod";

import type { ActionStatus } from "./actions";
import type { CapabilityDescriptor, CapabilityId, Device, DeviceKind } from "./capabilities";
import type { ErrorBody } from "./errors";
import type { Environment } from "./keys";

export const ADAPTER_TRANSPORTS = [
  "cloud_oauth",
  "phone_bridge_ble",
  "on_device_runtime",
  "local_bridge",
  "os_registry",
] as const;
export const AdapterTransportSchema = z.enum(ADAPTER_TRANSPORTS);
export type AdapterTransport = z.infer<typeof AdapterTransportSchema>;

/** C2 widget step 2: how this adapter pairs. */
export const PAIRING_METHODS = ["code", "oauth", "local_claim"] as const;
export const PairingMethodSchema = z.enum(PAIRING_METHODS);
export type PairingMethod = z.infer<typeof PairingMethodSchema>;

/** The Connect session an adapter pairs inside. */
export interface PairingSession {
  connect_session_id: string;
  project_id: string;
  external_user_id: string;
  env: Environment;
}

export type PairingFlow =
  | { method: "code"; code: string; expires_at: string }
  | { method: "oauth"; authorize_url: string; state: string }
  | { method: "local_claim"; claim_token: string; expires_at: string };

export interface ActionResult {
  status: ActionStatus;
  result: Record<string, unknown> | null;
  error: ErrorBody | null;
}

/** Device-originated input and telemetry (C3 `input` family; the `input.utterance` webhook). */
export type DeviceEvent =
  | { type: "input.utterance" | "input.tap" | "input.gesture" | "input.button"; device_id: string; ts: string; data: Record<string, unknown> }
  | { type: "telemetry"; device_id: string; ts: string; data: Record<string, unknown> };

export interface DeviceHealth {
  online: boolean;
  /** ISO 8601, null if never seen. */
  last_seen: string | null;
  firmware: string | null;
}

/** Device I/O is network-bound, so the spec's sketch returns are Promises here. */
export interface DeviceAdapter {
  /** e.g. `even_g2`; with `version` forms `since_adapter` (`even_g2@0.3`). */
  id: string;
  version: string;
  kinds: DeviceKind[];
  transport: AdapterTransport;
  /** D6: reverse-engineered protocol → true. */
  experimental: boolean;
  /** Feeds the C2 compatibility pre-check and the C3 descriptors. */
  describe(device: Device): CapabilityDescriptor[];
  pair(session: PairingSession): Promise<PairingFlow>;
  execute(device: Device, capability: CapabilityId, args: Record<string, unknown>): Promise<ActionResult>;
  events(device: Device): AsyncIterable<DeviceEvent>;
  health(device: Device): Promise<DeviceHealth>;
}
