/** Figures every page computes the same way, so a number never disagrees between two pages. */
import type { IntegrationId, ModelId } from "../_data/catalog";
import { integrationOf } from "../_data/catalog";
import { userDeliveries, userSeen, type OwnedDevice, type PortalUser } from "../_data/users";

export interface Figures {
  deliveries: number;
  seen: number;
  rate: number;
  users: number;
  online: number;
  devices: number;
}

export function figuresOfDevices(devices: OwnedDevice[]): Figures {
  const deliveries = devices.reduce((n, d) => n + d.deliveries7d, 0);
  const seen = devices.reduce((n, d) => n + d.seen7d, 0);
  return {
    deliveries,
    seen,
    rate: deliveries === 0 ? 0 : Math.round((seen / deliveries) * 1000) / 10,
    users: new Set(devices.map((d) => d.userId)).size,
    online: devices.filter((d) => d.state === "online").length,
    devices: devices.length,
  };
}

export const figuresOfUsers = (users: PortalUser[]) => figuresOfDevices(users.flatMap((u) => u.devices));

export const devicesOfModel = (users: PortalUser[], id: ModelId) => users.flatMap((u) => u.devices).filter((d) => d.modelId === id);
export const devicesOfIntegration = (users: PortalUser[], id: IntegrationId) =>
  users.flatMap((u) => u.devices).filter((d) => integrationOf(d.modelId).id === id);

export const activeWithin = (users: PortalUser[], mins: number) => users.filter((u) => u.lastActiveMins <= mins).length;

export const totalOf = (users: PortalUser[]) => users.reduce((n, u) => n + userDeliveries(u), 0);
export const seenOf = (users: PortalUser[]) => users.reduce((n, u) => n + userSeen(u), 0);

export const WEEK = 7 * 1440;
