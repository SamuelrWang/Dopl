import type { ComputerDeviceDto, ConnectedDevice } from "./types";
import { platformLabel } from "./types";

/** The glasses source's wire row (`GET /api/glasses/devices`), the fields this list reads. */
export interface GlassesSourceRow {
  id: string;
  name: string;
  platform: string;
  created_at: string;
  last_seen: string | null;
  online: boolean;
  linked_channel: { id: string; name: string } | null;
  has_hey_even_key: boolean;
}

export function computerToDevice(row: ComputerDeviceDto): ConnectedDevice {
  return {
    id: row.id,
    kind: "computer",
    name: row.name,
    platform: row.platform,
    platformLabel: row.platform ? platformLabel(row.platform) : "Computer",
    online: row.online,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    current: row.current,
    appVersion: row.app_version,
    legacy: row.legacy,
  };
}

export function glassesToDevice(row: GlassesSourceRow): ConnectedDevice {
  return {
    id: row.id,
    kind: "glasses",
    name: row.name,
    platform: row.platform,
    platformLabel: platformLabel(row.platform),
    online: row.online,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    linkedChannel: row.linked_channel,
    hasHeyEvenKey: row.has_hey_even_key,
  };
}

/**
 * ONE LIST OVER EVERY SOURCE: this computer first, then online devices, then the rest by last
 * seen. Each source keeps its own endpoint (glasses are owned by the glasses feature); a new kind
 * is one more mapper here.
 */
export function mergeDevices(
  computers: readonly ComputerDeviceDto[],
  glasses: readonly GlassesSourceRow[]
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
