import { HttpError } from "@/shared/lib/http-error";
import { iso, nowOf, type Clock } from "../clock";
import { bearerOf } from "../http";
import { isUuid } from "../validation";
import { hashCredential } from "./credentials";
import type { DeviceStore, GlassesDevice } from "./types";

/**
 * The signed-in user's view of their glasses (list, rename, link a channel,
 * revoke) and the bearer lookups the device-facing routes authenticate with.
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
  /** The channels in `ids` that `userId` may link (member of a live channel); others are absent. */
  linkable(userId: string, ids: string[]): Promise<Map<string, ChannelLink>>;
}

export async function linkOf(linker: ChannelLinker, userId: string, channelId: string): Promise<ChannelLink | null> {
  return (await linker.linkable(userId, [channelId])).get(channelId) ?? null;
}

/** The channel, if `userId` may link it; else 404. */
export async function requireLink(linker: ChannelLinker, userId: string, channelId: string): Promise<ChannelLink> {
  const link = await linkOf(linker, userId, channelId);
  if (!link) {
    throw new HttpError(404, "CHANNEL_NOT_FOUND", "No such channel, or you cannot link it (not a member, archived or deleted).");
  }
  return link;
}

export interface DeviceDto {
  id: string;
  name: string;
  platform: string;
  created_at: string;
  last_seen: string | null;
  online: boolean;
  linked_channel: { id: string; name: string } | null;
  /** Wire name kept for existing clients (docs/glasses-mcp.md); it means "has an assistant key". */
  has_hey_even_key: boolean;
}

export function isOnline(device: Pick<GlassesDevice, "last_seen">, now: number): boolean {
  return device.last_seen !== null && now - Date.parse(device.last_seen) <= DEVICE_ONLINE_WINDOW_MS;
}

/** `links` holds only channels the owner may still see; any other link renders as none. */
export function toDeviceDto(device: GlassesDevice, links: Map<string, ChannelLink>, now: number): DeviceDto {
  const link = device.linked_channel_id ? links.get(device.linked_channel_id) : undefined;
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    created_at: device.created_at,
    last_seen: device.last_seen,
    online: isOnline(device, now),
    linked_channel: link ? { id: link.channelId, name: link.name } : null,
    has_hey_even_key: device.has_assistant_key,
  };
}

export interface DevicesDeps extends Clock {
  devices: DeviceStore;
  linker: ChannelLinker;
}

export const deviceNotFound = () => new HttpError(404, "DEVICE_NOT_FOUND", "No such device.");

export async function listDevices(deps: DevicesDeps, userId: string) {
  const devices = await deps.devices.listDevices(userId);
  const ids = [...new Set(devices.map((d) => d.linked_channel_id).filter((x): x is string => !!x))];
  const links = ids.length ? await deps.linker.linkable(userId, ids) : new Map<string, ChannelLink>();
  const now = nowOf(deps);
  return { devices: devices.map((d) => toDeviceDto(d, links, now)) };
}

export async function updateDevice(
  deps: DevicesDeps,
  userId: string,
  id: string,
  patch: { name?: string; channel_id?: string | null },
): Promise<DeviceDto> {
  if (!isUuid(id)) throw deviceNotFound();
  const update: { name?: string; linkedChannelId?: string | null; linkedContainerId?: string | null } = {};
  let links = new Map<string, ChannelLink>();
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.channel_id === null) {
    update.linkedChannelId = null;
  } else if (patch.channel_id !== undefined) {
    const link = await requireLink(deps.linker, userId, patch.channel_id);
    update.linkedChannelId = link.channelId;
    update.linkedContainerId = link.containerId;
    links = new Map([[link.channelId, link]]);
  }
  const device = await deps.devices.updateDevice(userId, id, update);
  if (!device) throw deviceNotFound();
  if (device.linked_channel_id && !links.has(device.linked_channel_id)) {
    links = await deps.linker.linkable(userId, [device.linked_channel_id]);
  }
  return toDeviceDto(device, links, nowOf(deps));
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
