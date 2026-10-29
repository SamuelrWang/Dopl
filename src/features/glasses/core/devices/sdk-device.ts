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

/** A `dev_actions` row a lens answer or dismiss just settled (`lens-actions.ts › MovedLensAction`). */
export interface SdkSettledAction {
  id: string;
  project_id: string;
  env: string;
  /** The caller's `Idempotency-Key`: the Dopl app's own SDK asks carry their channel link in it. */
  idempotency_key: string;
  status: string;
  result: Record<string, unknown> | null;
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
  /**
   * A lens row was answered or dismissed: settle the `dev_actions` row it serves. Returns the actions
   * THIS call moved (none when another hop settled them first); `void` from older fakes reads as none.
   */
  settled(deviceId: string, row: GlassesMessage): Promise<SdkSettledAction[] | void>;
  /**
   * W1.2 dogfood window (Plan §8): the ids of this Dopl user's prosumer glasses that were MIGRATED to
   * SDK rows (same id, `sdk_delivery` on). Such a device still signs in with its legacy token, so the
   * prosumer lookup wins; its inbox then also carries its SDK lens queue. Throws on a failed lookup.
   * Absent = no migrated devices.
   */
  migratedDeviceIds?(userId: string): Promise<string[]>;
  /**
   * True when `projectId` is the Dopl app's own project (the internal org's "Dopl App") and `env` is
   * `live`: only its actions may be bridged to a Dopl user's channel. Absent = never (fail closed).
   */
  isDoplAppProject?(projectId: string, env: string): Promise<boolean>;
}
