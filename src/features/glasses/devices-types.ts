/** A `glasses_device_links` row, minus its credential hashes. */
export interface GlassesDevice {
  id: string;
  user_id: string;
  name: string;
  platform: string;
  linked_channel_id: string | null;
  linked_container_id: string | null;
  reply_cursor_seq: number | null;
  created_at: string;
  last_seen: string | null;
  revoked_at: string | null;
  has_hey_even_key: boolean;
}

export type PairingStatus = "pending" | "claimed" | "expired";

export interface GlassesPairing {
  id: string;
  code: string;
  poll_secret_hash: string;
  status: PairingStatus;
  device_id: string | null;
  token_issued_at: string | null;
  expires_at: string;
}

export interface NewDevice {
  userId: string;
  name: string;
  platform: string;
  linkedChannelId: string | null;
  linkedContainerId: string | null;
  now: string;
}

/**
 * Every DB operation the device model needs. `devices-repository.ts` is the real
 * one; `fake-device-store.ts` mirrors it for tests. Credentials cross this
 * boundary as HASHES only.
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
  /** Delete pairings that expired before `cutoff` (housekeeping; they are never read again). */
  deleteStalePairings(cutoff: string): Promise<void>;

  insertDevice(d: NewDevice): Promise<GlassesDevice>;
  /** Paired devices: unrevoked AND holding a device token (a claim whose token was never
   *  collected is not a device yet). */
  listDevices(userId: string): Promise<GlassesDevice[]>;
  /** Active (unrevoked) device by credential hash. */
  findDeviceByTokenHash(hash: string): Promise<GlassesDevice | null>;
  findDeviceByHeyEvenKeyHash(hash: string): Promise<GlassesDevice | null>;
  setTokenHash(deviceId: string, hash: string): Promise<void>;
  /** `false` when no active device matched. */
  setHeyEvenKeyHash(userId: string, deviceId: string, hash: string): Promise<boolean>;
  updateDevice(
    userId: string,
    id: string,
    patch: { name?: string; linkedChannelId?: string | null; linkedContainerId?: string | null },
  ): Promise<GlassesDevice | null>;
  revokeDevice(userId: string, id: string, now: string): Promise<boolean>;
  touchDevice(deviceId: string, now: string): Promise<void>;
  setReplyCursor(deviceId: string, seq: number | null): Promise<void>;
  countActiveDevices(userId: string): Promise<number>;
}
