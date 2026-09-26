import { HttpError } from "@/shared/lib/http-error";
import { bearerOf, hashCredential, mintHeyEvenKey } from "./credentials";
import type { DeviceStore, GlassesDevice } from "./devices-types";
import { isUuid } from "./text";

/**
 * The signed-in user's view of their glasses (list, rename, link a channel,
 * revoke, rotate the Hey Even key) and the two bearer lookups the device-facing
 * routes authenticate with.
 */

export const DEVICE_ONLINE_WINDOW_MS = 60_000;
export const DEVICE_NAME_MAX = 64;

export interface ChannelLink {
  channelId: string;
  containerId: string;
  name: string;
}

/** Channel reads the device model needs; `channel-link.ts` is the real one. */
export interface ChannelLinker {
  /** The channel, if `userId` may link it (a member of a live channel); else throws 404. */
  resolveLink(userId: string, channelId: string): Promise<ChannelLink>;
  /** Names of the channels in `ids` that `userId` may still link; others are absent. */
  visibleChannelNames(userId: string, ids: string[]): Promise<Map<string, string>>;
  isLinkable(userId: string, channelId: string): Promise<boolean>;
}

export interface DeviceDto {
  id: string;
  name: string;
  platform: string;
  created_at: string;
  last_seen: string | null;
  online: boolean;
  linked_channel: { id: string; name: string } | null;
  has_hey_even_key: boolean;
}

export function isOnline(device: Pick<GlassesDevice, "last_seen">, now: number): boolean {
  return device.last_seen !== null && now - Date.parse(device.last_seen) <= DEVICE_ONLINE_WINDOW_MS;
}

/** `names` holds only channels the owner may still see; any other link renders as none. */
export function toDeviceDto(device: GlassesDevice, names: Map<string, string>, now: number): DeviceDto {
  const channelId = device.linked_channel_id && names.has(device.linked_channel_id) ? device.linked_channel_id : null;
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    created_at: device.created_at,
    last_seen: device.last_seen,
    online: isOnline(device, now),
    linked_channel: channelId ? { id: channelId, name: names.get(channelId)! } : null,
    has_hey_even_key: device.has_hey_even_key,
  };
}

export interface DevicesDeps {
  devices: DeviceStore;
  linker: ChannelLinker;
  now?: () => number;
}

const notFound = () => new HttpError(404, "DEVICE_NOT_FOUND", "No such device.");

export async function listDevices(deps: DevicesDeps, userId: string) {
  const devices = await deps.devices.listDevices(userId);
  const ids = [...new Set(devices.map((d) => d.linked_channel_id).filter((x): x is string => !!x))];
  const names = ids.length ? await deps.linker.visibleChannelNames(userId, ids) : new Map<string, string>();
  const now = (deps.now ?? Date.now)();
  return { devices: devices.map((d) => toDeviceDto(d, names, now)) };
}

export async function updateDevice(
  deps: DevicesDeps,
  userId: string,
  id: string,
  patch: { name?: string; channel_id?: string | null },
): Promise<DeviceDto> {
  if (!isUuid(id)) throw notFound();
  const update: { name?: string; linkedChannelId?: string | null; linkedContainerId?: string | null } = {};
  let names = new Map<string, string>();
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.channel_id === null) {
    update.linkedChannelId = null;
  } else if (patch.channel_id !== undefined) {
    const link = await deps.linker.resolveLink(userId, patch.channel_id);
    update.linkedChannelId = link.channelId;
    update.linkedContainerId = link.containerId;
    names = new Map([[link.channelId, link.name]]);
  }
  const device = await deps.devices.updateDevice(userId, id, update);
  if (!device) throw notFound();
  if (device.linked_channel_id && !names.has(device.linked_channel_id)) {
    names = await deps.linker.visibleChannelNames(userId, [device.linked_channel_id]);
  }
  return toDeviceDto(device, names, (deps.now ?? Date.now)());
}

export async function revokeDevice(deps: DevicesDeps, userId: string, id: string) {
  if (!isUuid(id)) throw notFound();
  const ok = await deps.devices.revokeDevice(userId, id, new Date((deps.now ?? Date.now)()).toISOString());
  if (!ok) throw notFound();
  return { ok: true as const };
}

/** A fresh Hey Even key, returned once. Rotating replaces (and so revokes) the previous key. */
export async function rotateHeyEvenKey(deps: DevicesDeps, userId: string, id: string, baseUrl: string) {
  if (!isUuid(id)) throw notFound();
  const key = mintHeyEvenKey();
  if (!(await deps.devices.setHeyEvenKeyHash(userId, id, hashCredential(key)))) throw notFound();
  return { key, url: `${baseUrl.replace(/\/+$/, "")}/api/glasses/hey-even/v1/chat/completions` };
}

/** The active device a `Bearer <device token>` belongs to, or null. */
export async function deviceFromBearer(store: DeviceStore, request: Request): Promise<GlassesDevice | null> {
  const token = bearerOf(request);
  return token ? store.findDeviceByTokenHash(hashCredential(token)) : null;
}

/** The active device a `Bearer <Hey Even key>` belongs to, or null. */
export async function deviceFromHeyEvenKey(store: DeviceStore, request: Request): Promise<GlassesDevice | null> {
  const key = bearerOf(request);
  return key ? store.findDeviceByHeyEvenKeyHash(hashCredential(key)) : null;
}
