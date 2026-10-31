"use client";

/** One user as a row: the Users list and a device's Users tab. */
import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { StatusPill } from "@/shared/ui/status-pill";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { modelById } from "../_data/catalog";
import { hasStale, needsRelink, ownedDevice, userDeliveries, userRate, type OwnedDevice, type PortalUser } from "../_data/users";
import { BASE, FactChip, Id, StateDot, UserFace, ov, since } from "./ui";

export const USER_GRID = "grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1fr)_72px_104px_minmax(0,1fr)] items-center gap-3";

export function DeviceChip({ device }: { device: OwnedDevice }) {
  return (
    <FactChip icon={<StateDot state={device.state} />} title={device.name}>
      {modelById(device.modelId).name}
    </FactChip>
  );
}

export function UserHeaderRow() {
  return (
    <div className={cn(USER_GRID, "px-3 text-caption text-text-muted")}>
      <span>User</span>
      <span>Devices</span>
      <span>Active device</span>
      <span>Last delivery</span>
      <span>Success rate</span>
      <span>Flags</span>
    </div>
  );
}

export function UserRow({ user }: { user: PortalUser }) {
  const active = user.activeDeviceId ? ownedDevice(user.activeDeviceId) : null;
  const rate = userRate(user);
  return (
    <li className={cn(USER_GRID, ov.openRow, "mx-0! min-h-12 border-t border-border-default px-0! py-1.5 first:border-t-0")}>
      <span className="flex min-w-0 items-center gap-2">
        <UserFace name={user.name} online={user.activeDeviceId !== null} />
        <span className="flex min-w-0 flex-col">
          <Link href={`${BASE}/users/${user.id}`} className={cn(ov.open, "truncate text-body font-medium text-text-primary")}>
            {user.name}
          </Link>
          <Id>{user.id}</Id>
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap gap-1">
        {user.devices.map((d) => (
          <DeviceChip key={d.id} device={d} />
        ))}
      </span>
      <span className="truncate text-caption text-text-secondary">{active ? active.name : "None online"}</span>
      <span className="text-caption text-text-muted">{since(user.lastDeliveryAt)}</span>
      <span className="flex items-center gap-2">
        <span className="w-8 text-caption font-medium tabular-nums text-text-primary">{userDeliveries(user) ? `${rate}%` : "None"}</span>
        <ThinMeter used={rate} limit={100} className="flex-1" />
      </span>
      <span className="flex min-w-0 flex-wrap gap-1">
        {needsRelink(user) && <StatusPill tone="attention">Needs relink</StatusPill>}
        {hasStale(user) && <StatusPill tone="attention">Stale pairing</StatusPill>}
      </span>
    </li>
  );
}
