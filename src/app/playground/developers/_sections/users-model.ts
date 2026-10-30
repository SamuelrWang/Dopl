/** The Users list's rules: what each filter keeps, how each column sorts, what each status means. */
import { categoryOf, type CategoryId } from "../_data/catalog";
import { hasIssues, hasStale, needsRelink, ownedDevice, userDeliveries, userRate, type DeviceState, type PortalUser } from "../_data/users";
import { matchesHierarchy } from "../_components/hierarchy-filter";
import type { UserFilters } from "../_components/portal-store";
import { WEEK } from "../_components/stats";

export type Quick = "all" | "online" | "attention" | "inactive";
export const QUICK: { key: Quick; label: string }[] = [
  { key: "all", label: "All" },
  { key: "online", label: "Online" },
  { key: "attention", label: "Needs attention" },
  { key: "inactive", label: "Inactive" },
];
const DAY = 1440;

export function inQuick(u: PortalUser, quick: Quick): boolean {
  if (quick === "online") return u.activeDeviceId !== null;
  if (quick === "attention") return hasIssues(u);
  if (quick === "inactive") return u.lastActiveMins > DAY;
  return true;
}

export function matches(u: PortalUser, f: UserFilters): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !u.name.toLowerCase().includes(q) && !u.id.toLowerCase().includes(q) && !u.devices.some((d) => d.id.toLowerCase().includes(q) || d.name.toLowerCase().includes(q))) return false;
  if (u.devices.length > 0 ? !u.devices.some((d) => matchesHierarchy(d.modelId, f)) : f.category !== "all" || f.integration !== "all" || f.model !== "all") return false;
  if (f.status === "online" && u.activeDeviceId === null) return false;
  if (f.status === "offline" && u.activeDeviceId !== null) return false;
  if (f.issues === "any" && !hasIssues(u)) return false;
  if (f.issues === "none" && hasIssues(u)) return false;
  if (f.issues === "relink" && !needsRelink(u)) return false;
  if (f.issues === "stale" && !hasStale(u)) return false;
  if (f.firmware !== "all" && !u.devices.some((d) => d.firmware === f.firmware)) return false;
  if (f.active === "today" && u.lastActiveMins > DAY) return false;
  if (f.active === "7d" && u.lastActiveMins > WEEK) return false;
  if (f.active === "over1d" && u.lastActiveMins <= DAY) return false;
  if (f.active === "over7" && u.lastActiveMins <= 2 * DAY) return false;
  return true;
}

export type Status = "relink" | "stale" | "online" | "offline";
export const STATUS_LABELS: Record<Status, string> = { relink: "Needs relink", stale: "Stale pairing", online: "Online", offline: "Offline" };

export function statusOf(u: PortalUser): Status {
  if (needsRelink(u)) return "relink";
  if (hasStale(u)) return "stale";
  return u.activeDeviceId !== null ? "online" : "offline";
}

export type SortKey = "name" | "devices" | "active" | "delivery" | "success" | "status";
export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}
/** A column's first press: numbers and times start with the biggest. */
export const FIRST_DIR: Record<SortKey, 1 | -1> = { name: 1, devices: -1, active: 1, delivery: -1, success: -1, status: 1 };

const SEVERITY: Record<Status, number> = { relink: 0, stale: 1, online: 2, offline: 3 };
const activeName = (u: PortalUser) => (u.activeDeviceId ? (ownedDevice(u.activeDeviceId)?.name ?? "") : "");
const stamp = (u: PortalUser) => (u.lastDeliveryAt ? Date.parse(u.lastDeliveryAt) : 0);

export function sortUsers(users: PortalUser[], { key, dir }: Sort): PortalUser[] {
  const value = (u: PortalUser): number | string => {
    if (key === "name") return u.name;
    if (key === "devices") return u.devices.length;
    if (key === "active") return activeName(u);
    if (key === "delivery") return stamp(u);
    if (key === "success") return userDeliveries(u) ? userRate(u) : -1;
    return SEVERITY[statusOf(u)];
  };
  return [...users].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (order * dir) || a.name.localeCompare(b.name);
  });
}

/** Online devices first, so the two a row shows are the two that matter. */
const RANK: Record<DeviceState, number> = { online: 0, needs_relink: 1, stale: 2, offline: 3 };
export const devicesInOrder = (u: PortalUser) => [...u.devices].sort((a, b) => RANK[a.state] - RANK[b.state]);

export const categoryIdOf = (modelId: Parameters<typeof categoryOf>[0]): CategoryId => categoryOf(modelId).id;

export function usersCsv(users: PortalUser[]): string {
  const cell = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  const head = ["Name", "User ID", "Devices", "Active device", "Last delivery", "Success rate", "Status"];
  const rows = users.map((u) => [u.name, u.id, u.devices.length, activeName(u), u.lastDeliveryAt ?? "", userDeliveries(u) ? `${userRate(u)}%` : "", STATUS_LABELS[statusOf(u)]]);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}
