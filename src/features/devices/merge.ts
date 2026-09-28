import { platformInfo } from "@/features/glasses/platforms/info";
import type { GlassesDevice } from "@/features/glasses/settings/glasses-api";
import { computerPlatformLabel, type ComputerDeviceDto, type ConnectedDevice } from "./types";

export function computerToDevice(row: ComputerDeviceDto): ConnectedDevice {
  return {
    id: row.id,
    kind: "computer",
    name: row.name,
    platform: row.platform,
    platformLabel: computerPlatformLabel(row.platform),
    online: row.online,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    current: row.current,
    appVersion: row.app_version,
    legacy: row.legacy,
  };
}

export function glassesToDevice(row: GlassesDevice): ConnectedDevice {
  return {
    id: row.id,
    kind: "glasses",
    name: row.name,
    platform: row.platform,
    platformLabel: platformInfo(row.platform)?.label ?? row.platform,
    online: row.online,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    glasses: row,
  };
}

/**
 * ONE LIST OVER EVERY SOURCE: this computer first, then online devices, then the rest by last
 * seen. Each source keeps its own endpoint (glasses are owned by the glasses feature); a new kind
 * is one more mapper here.
 */
export function mergeDevices(
  computers: readonly ComputerDeviceDto[],
  glasses: readonly GlassesDevice[]
): ConnectedDevice[] {
  return [...computers.map(computerToDevice), ...glasses.map(glassesToDevice)].sort(
    (a, b) =>
      Number(Boolean(b.current)) - Number(Boolean(a.current)) ||
      Number(b.online) - Number(a.online) ||
      (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "")
  );
}

/** `macOS · Online` / `Even G2 · 5m ago`. */
export function deviceMeta(device: ConnectedDevice, lastSeenText: string): string {
  const presence = device.online ? "Online" : device.lastSeen ? lastSeenText : "Offline";
  return [device.platformLabel, presence].filter(Boolean).join(" · ");
}
