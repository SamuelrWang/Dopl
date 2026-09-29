/**
 * DEVICES — the hardware a person's agents reach them through (Settings > Connect > Devices).
 *
 * `kind` is OPEN on purpose: computers (the desktop app) and glasses exist today; phones, robots
 * and whatever comes next join as new kinds with their own source, and every surface that lists
 * devices renders an unknown kind generically instead of dropping it (docs/devices.md).
 */

import type { GlassesDevice } from "@/features/glasses/settings/glasses-api";

export type DeviceKind = "computer" | "glasses" | (string & {});

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
  /** The name the computer reported; `name` is the operator's rename over it, when there is one. */
  detectedName?: string | null;
  /** The glasses source's own row, for that kind's controls (no re-search by id). */
  glasses?: GlassesDevice;
}

/** `GET /api/devices` — the computer source. */
export interface ComputerDeviceDto {
  id: string;
  kind: "computer";
  /** The effective name: the user's rename, else the detected one. */
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
  /** What the desktop reports; `name` is the rename over it. Optional: older payloads lack it. */
  detected_name?: string;
  renamed?: boolean;
}

export interface ComputerDeviceList {
  devices?: ComputerDeviceDto[];
}

export type DesktopDevicePlatform = "macos" | "windows" | "linux";
export type DesktopDeviceStatus = "active" | "away" | "offline";

/** One connected agent app, every OAuth registration of it folded together. */
export interface AgentApp {
  /** Stable group key (`agent-apps.ts › appKey`: name + redirect host); the Disconnect address. */
  key: string;
  name: string;
  /** The client's redirect host — shown so a look-alike name cannot pass for the real app. */
  host: string | null;
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

/** Computer platforms. A glasses platform's label comes from the glasses platform registry. */
const COMPUTER_PLATFORM_LABELS: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

export function computerPlatformLabel(platform: string): string {
  return COMPUTER_PLATFORM_LABELS[platform] ?? (platform || "Computer");
}
