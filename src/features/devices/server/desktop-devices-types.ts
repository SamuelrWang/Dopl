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
  tokenLabel?: string;
}

/** Every DB operation the computer source needs; `desktop-devices-repository.ts` is the real one. */
export interface DesktopDeviceStore {
  findByInstall(userId: string, installId: string): Promise<DesktopDeviceRow | null>;
  /** Insert, or refresh the unrevoked row for (user, install). */
  upsert(userId: string, input: HeartbeatInput, now: string): Promise<DesktopDeviceRow>;
  listActive(userId: string): Promise<DesktopDeviceRow[]>;
  /** Unrevoked, unexpired device-client tokens, container sessions excluded. */
  listDeviceTokens(userId: string, now: string): Promise<DeviceTokenRow[]>;
  /** Attach this user's unlinked device tokens minted under `label` to `deviceId`. */
  linkTokensByLabel(userId: string, deviceId: string, label: string): Promise<void>;
  /** `false` when no active row matched. */
  revoke(userId: string, deviceId: string, now: string): Promise<boolean>;
  /** Every unrevoked credential linked to the device (device token + container sessions). */
  revokeLinkedTokens(userId: string, deviceId: string, now: string): Promise<number>;
  /** One unlinked device token and any sibling minted under the same label. */
  revokeLegacyToken(userId: string, tokenId: string, now: string): Promise<number>;
}
