import type { GlassesMessage, GlassesStore } from "../messages/types";

/**
 * A G2 owned by a Device SDK end user (paired through Connect, A4; D1: no Dopl account), as the
 * device routes see it. It authenticates with the token `pairing.ts › pairingStatus` minted into
 * `device_credentials`, and reads its OWN lens queue (`dev_device_messages`), never a user's.
 */
export interface SdkGlassesDevice {
  /** `devices.id` (SDK owner shape). */
  id: string;
  projectId: string;
  env: string;
}

/**
 * Everything the device routes need for an SDK G2 (A8). Implemented over the service role in
 * `device-sdk/server/glasses/sdk-glasses-port.ts`. Absent = prosumer-only: every prosumer caller and
 * test before A8, whose behaviour is unchanged.
 *
 * 🔒 Credentials cross it as HASHES only, and `store` is keyed by the SDK DEVICE id: an SDK device can
 * only ever read and answer its own rows.
 */
export interface SdkGlassesPort {
  /** The live SDK G2 whose live `device_token` credential has this sha256 hex, or null. */
  deviceFromTokenHash(hash: string): Promise<SdkGlassesDevice | null>;
  /** The SDK device's lens queue: the {@link GlassesStore} contract with the device id as the key. */
  store: GlassesStore;
  /** Presence: stamp `devices.last_seen` (throttled by the caller). */
  touch(deviceId: string, now: string): Promise<void>;
  /** The glasses signed out: the device's token dies (the `devices` row and its grant stay). */
  revokeToken(deviceId: string, now: string): Promise<void>;
  /** Lens rows the inbox just handed to the glasses (pending → delivered). */
  delivered(deviceId: string, messageIds: string[]): Promise<void>;
  /** A lens row was answered or dismissed: settle the `dev_actions` row it serves. */
  settled(deviceId: string, row: GlassesMessage): Promise<void>;
}
