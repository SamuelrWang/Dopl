/**
 * DEVICES — the hardware a person's agents reach them through (Settings > Connect > Devices).
 *
 * `kind` is OPEN on purpose: computers (the desktop app) and glasses exist today; phones, robots
 * and whatever comes next join as new kinds with their own source, and every surface that lists
 * devices renders an unknown kind generically instead of dropping it (docs/devices.md).
 */

export type DeviceKind = "computer" | "glasses" | (string & {});

export interface DeviceChannelLink {
  id: string;
  name: string;
}

/** One row of the unified list. Kind-specific fields are optional and read only by that kind's row. */
export interface ConnectedDevice {
  id: string;
  kind: DeviceKind;
  name: string;
  /** Wire value (`macos`, `even_g2`, …); `platformLabel` is the display word. */
  platform: string;
  platformLabel: string;
  online: boolean;
  lastSeen: string | null;
  createdAt: string;
  /** The computer this request came from. */
  current?: boolean;
  appVersion?: string | null;
  /** A computer that minted a device token before it could register (an older desktop build). */
  legacy?: boolean;
  linkedChannel?: DeviceChannelLink | null;
  hasHeyEvenKey?: boolean;
}

/** `GET /api/devices` — the computer source. */
export interface ComputerDeviceDto {
  id: string;
  kind: "computer";
  name: string;
  platform: string;
  online: boolean;
  status: DesktopDeviceStatus | null;
  last_seen: string | null;
  created_at: string;
  app_version: string | null;
  os_version: string | null;
  current: boolean;
  legacy: boolean;
}

export interface ComputerDeviceList {
  devices?: ComputerDeviceDto[];
}

export type DesktopDevicePlatform = "macos" | "windows" | "linux";
export type DesktopDeviceStatus = "active" | "away" | "offline";

/** One connected agent app, every OAuth registration of it folded together. */
export interface AgentApp {
  /** Stable group key (slug of the app name); the Disconnect address. */
  key: string;
  name: string;
  connections: number;
  last_used_at: string | null;
  created_at: string;
}

export interface AgentAppList {
  apps?: AgentApp[];
}

export const DEVICES_PATH = "/api/devices";
export const AGENT_APPS_PATH = "/api/oauth/apps";
/** The desktop's per-install id, on every request it makes. */
export const DEVICE_HEADER = "x-dopl-device";

const PLATFORM_LABELS: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  even_g2: "Even G2",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}
