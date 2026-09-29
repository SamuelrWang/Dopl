import { HttpError } from "@/shared/lib/http-error";
import { iso, nowOf, type Clock } from "../clock";
import { bearerOf } from "../http";
import { isUuid } from "../validation";
import { hashCredential } from "./credentials";
import type { DeviceStore, GlassesDevice } from "./types";

/**
 * The signed-in user's view of their glasses (list, rename, revoke) and the
 * bearer lookups the device-facing routes authenticate with. A device has no
 * linked channel: where it talks is chosen on the glasses (`voice/target.ts`).
 */

const DEVICE_ONLINE_WINDOW_MS = 60_000;
export const DEVICE_NAME_MAX = 64;

export interface ChannelLink {
  channelId: string;
  containerId: string;
  name: string;
}

/** Channel reads the device model needs; `channel-link.ts` is the real one. */
export interface ChannelLinker {
  /** The channels in `ids` that `userId` may use (member of a live channel); others are absent. */
  linkable(userId: string, ids: string[]): Promise<Map<string, ChannelLink>>;
  /** The user's most recently active usable channel (direct messages excluded), or null. */
  mostRecent(userId: string): Promise<ChannelLink | null>;
}

export async function linkOf(linker: ChannelLinker, userId: string, channelId: string): Promise<ChannelLink | null> {
  return (await linker.linkable(userId, [channelId])).get(channelId) ?? null;
}

export interface DeviceDto {
  id: string;
  name: string;
  platform: string;
  created_at: string;
  last_seen: string | null;
  online: boolean;
  /** Wire name kept for existing clients (docs/glasses-mcp.md); it means "has an assistant key". */
  has_hey_even_key: boolean;
}

export function isOnline(device: Pick<GlassesDevice, "last_seen">, now: number): boolean {
  return device.last_seen !== null && now - Date.parse(device.last_seen) <= DEVICE_ONLINE_WINDOW_MS;
}

export function toDeviceDto(device: GlassesDevice, now: number): DeviceDto {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    created_at: device.created_at,
    last_seen: device.last_seen,
    online: isOnline(device, now),
    has_hey_even_key: device.has_assistant_key,
  };
}

export interface DevicesDeps extends Clock {
  devices: DeviceStore;
}

export const deviceNotFound = () => new HttpError(404, "DEVICE_NOT_FOUND", "No such device.");

export async function listDevices(deps: DevicesDeps, userId: string) {
  const devices = await deps.devices.listDevices(userId);
  const now = nowOf(deps);
  return { devices: devices.map((d) => toDeviceDto(d, now)) };
}

/**
 * Rename. `channel_id` is still ACCEPTED (older clients send it) and ignored:
 * the per-device linked channel is retired (docs/glasses-mcp.md › Voice routing).
 */
export async function updateDevice(
  deps: DevicesDeps,
  userId: string,
  id: string,
  patch: { name?: string; channel_id?: unknown },
): Promise<DeviceDto> {
  if (!isUuid(id)) throw deviceNotFound();
  const device = await deps.devices.updateDevice(userId, id, patch.name !== undefined ? { name: patch.name.trim() } : {});
  if (!device) throw deviceNotFound();
  return toDeviceDto(device, nowOf(deps));
}

export async function revokeDevice(deps: DevicesDeps, userId: string, id: string) {
  if (!isUuid(id)) throw deviceNotFound();
  if (!(await deps.devices.revokeDevice(userId, id, iso(nowOf(deps))))) throw deviceNotFound();
  return { ok: true as const };
}

/** The active device a `Bearer <device token>` belongs to, or null. */
export async function deviceFromBearer(store: DeviceStore, request: Request): Promise<GlassesDevice | null> {
  const token = bearerOf(request);
  return token ? store.findDeviceByTokenHash(hashCredential(token)) : null;
}
