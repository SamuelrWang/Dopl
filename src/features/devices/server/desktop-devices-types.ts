import type {
  DesktopDevicePlatform,
  DesktopDeviceStatus,
} from "../types";

/** A `desktop_devices` row. */
export interface DesktopDeviceRow {
  id: string;
  user_id: string;
  install_id: string;
  name: string;
  platform: DesktopDevicePlatform;
  os_version: string | null;
  app_version: string | null;
  arch: string | null;
  status: DesktopDeviceStatus;
  created_at: string;
  last_seen: string | null;
  revoked_at: string | null;
  /** `session_id` of the Supabase sign-in the desktop heartbeats with; ended on Remove. */
  auth_session_id: string | null;
}

/** An active (unrevoked, unexpired) desktop DEVICE token — the credential a computer mints. */
export interface DeviceTokenRow {
  id: string;
  client_name: string | null;
  device_id: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface HeartbeatInput {
  installId: string;
  name: string;
  platform: DesktopDevicePlatform;
  osVersion?: string;
  appVersion?: string;
  arch?: string;
  status: DesktopDeviceStatus;
  /** The device token this machine holds (sent once after sign-in / a re-mint). */
  tokenId?: string;
  /** Older desktop records with no token id: the label it was minted under. */
  tokenLabel?: string;
}

/** Every DB operation the computer source needs; `desktop-devices-repository.ts` is the real one. */
export interface DesktopDeviceStore {
  findByInstall(userId: string, installId: string): Promise<DesktopDeviceRow | null>;
  /** Refresh the ACTIVE row for (user, install); null when there is none (new, or removed). */
  touch(userId: string, input: HeartbeatInput, sessionId: string | null, now: string): Promise<DesktopDeviceRow | null>;
  /** Insert a new row; null when (user, install) already exists (a race, or a removed row). */
  insert(userId: string, input: HeartbeatInput, sessionId: string | null, now: string): Promise<DesktopDeviceRow | null>;
  listActive(userId: string): Promise<DesktopDeviceRow[]>;
  /** Unrevoked, unexpired device-client tokens, container sessions excluded. */
  listDeviceTokens(userId: string, now: string): Promise<DeviceTokenRow[]>;
  /** Attach one of this user's unlinked device tokens to `deviceId`. */
  linkTokenById(userId: string, deviceId: string, tokenId: string): Promise<void>;
  /** Legacy fallback: unlinked device tokens minted under `label`. */
  linkTokensByLabel(userId: string, deviceId: string, label: string): Promise<void>;
  /** Stamp the row removed; returns it, or null when no active row matched. */
  revoke(userId: string, deviceId: string, now: string): Promise<DesktopDeviceRow | null>;
  /** Every unrevoked credential linked to the device (device token + container sessions). */
  revokeLinkedTokens(userId: string, deviceId: string, now: string): Promise<number>;
  /** One unlinked device token, by id. */
  revokeLegacyToken(userId: string, tokenId: string, now: string): Promise<number>;
  /** End one Supabase sign-in of this user (`end_auth_session`); false when it was already gone. */
  endAuthSession(userId: string, sessionId: string): Promise<boolean>;
}
