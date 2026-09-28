/** A `glasses_device_links` row, minus its credential hashes. */
export interface GlassesDevice {
  id: string;
  user_id: string;
  name: string;
  /** Selects the platform implementation (`platforms/registry.ts`). */
  platform: string;
  /** Where voice goes by default (set by opening a chat/read view on the glasses); re-validated on every use. */
  current_target_channel_id: string | null;
  current_target_agent: string | null;
  created_at: string;
  last_seen: string | null;
  revoked_at: string | null;
  has_assistant_key: boolean;
}

type PairingStatus = "pending" | "claimed" | "expired";

export interface GlassesPairing {
  id: string;
  code: string;
  poll_secret_hash: string;
  status: PairingStatus;
  device_id: string | null;
  token_issued_at: string | null;
  expires_at: string;
}

interface NewDevice {
  userId: string;
  name: string;
  platform: string;
  now: string;
}

/**
 * A `glasses_device_channel_activity` row: the reply mirror's state for one
 * channel a device has targeted or posted to (`messages/reply-mirror.ts`).
 */
export interface DeviceChannelActivity {
  channel_id: string;
  /** The device's last voice / Hey Even post there; null when only ever targeted. */
  last_posted_at: string | null;
  reply_cursor_seq: number;
  /** When the cursor was last confirmed; a stale one restarts at the channel head. */
  cursor_at: string;
}

/**
 * Every DB operation the device model needs (`repository.ts`; tests use
 * `testing/fake-device-store.ts`). Credentials cross this boundary as HASHES only.
 */
export interface DeviceStore {
  /** Insert a pending pairing; `false` when the code collided with a live one. */
  insertPairing(p: { code: string; pollSecretHash: string; expiresAt: string; now: string }): Promise<GlassesPairing | false>;
  getPairing(id: string): Promise<GlassesPairing | null>;
  findPendingPairingByCode(code: string, now: string): Promise<GlassesPairing | null>;
  /** pending → claimed, only if still pending and unexpired. */
  claimPairing(id: string, deviceId: string, now: string): Promise<boolean>;
  /** Stamp `token_issued_at` once; `true` only for the single caller that won. */
  markTokenIssued(id: string, now: string): Promise<boolean>;
  /** Free a code held by an EXPIRED pending pairing (after an insert collided on it). */
  expirePairingCode(code: string, now: string): Promise<void>;
  /** Delete pairings that expired before `cutoff`; nothing reads them past expiry. */
  deleteStalePairings(cutoff: string): Promise<void>;

  insertDevice(d: NewDevice): Promise<GlassesDevice>;
  /** Unrevoked AND holding a device token: a claim whose token was never collected is not a device yet. */
  listDevices(userId: string): Promise<GlassesDevice[]>;
  findDeviceByTokenHash(hash: string): Promise<GlassesDevice | null>;
  findDeviceByAssistantKeyHash(hash: string): Promise<GlassesDevice | null>;
  setTokenHash(deviceId: string, hash: string): Promise<void>;
  /** `false` when no active device matched. */
  setAssistantKeyHash(userId: string, deviceId: string, hash: string): Promise<boolean>;
  updateDevice(
    userId: string,
    id: string,
    patch: { name?: string },
  ): Promise<GlassesDevice | null>;
  revokeDevice(userId: string, id: string, now: string): Promise<boolean>;
  touchDevice(deviceId: string, now: string): Promise<void>;
  /** Every mirror-state row of the device (one per channel it targeted or posted to). */
  listChannelActivity(deviceId: string): Promise<DeviceChannelActivity[]>;
  /** Stamp a post; with `cursor`, also (re)start that channel's mirror cursor (upsert). */
  recordChannelPost(deviceId: string, channelId: string, now: string, cursor: { seq: number; at: string } | null): Promise<void>;
  /** Upsert mirror cursors; leaves `last_posted_at` untouched. */
  setChannelCursors(deviceId: string, cursors: { channelId: string; seq: number; at: string }[]): Promise<void>;
  setCurrentTarget(deviceId: string, channelId: string | null, agentId: string | null, now: string): Promise<void>;
  countActiveDevices(userId: string): Promise<number>;
}
