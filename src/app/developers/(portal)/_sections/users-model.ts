/** The Users list's rules: what each filter keeps, how each column sorts, what each status means. */
import { categoryOf, integrationOf } from "@/features/device-sdk/portal/catalog";
import { hasIssues, hasStale, needsRelink, userDeliveries, userRate, type DeviceState, type PortalUser } from "@/features/device-sdk/portal/view";
import { portalNow } from "../_components/format";

export interface UserFilters {
  q: string;
  category: string;
  integration: string;
  model: string;
  active: string;
}
export const NO_FILTERS: UserFilters = { q: "", category: "all", integration: "all", model: "all", active: "all" };

export type Quick = "all" | "online" | "attention" | "inactive";
export const QUICK: { key: Quick; label: string }[] = [
  { key: "all", label: "All" },
  { key: "online", label: "Online" },
  { key: "attention", label: "Needs attention" },
  { key: "inactive", label: "Inactive" },
];
const DAY_MS = 86_400_000;
const idleMs = (u: PortalUser) => (u.lastActiveAt ? portalNow() - Date.parse(u.lastActiveAt) : Infinity);

export function inQuick(u: PortalUser, quick: Quick): boolean {
  if (quick === "online") return u.activeDeviceId !== null;
  if (quick === "attention") return hasIssues(u);
  if (quick === "inactive") return idleMs(u) > DAY_MS;
  return true;
}

export function matches(u: PortalUser, f: UserFilters): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !u.name.toLowerCase().includes(q) && !u.id.toLowerCase().includes(q) && !u.devices.some((d) => d.id.toLowerCase().includes(q) || d.name.toLowerCase().includes(q))) return false;
  const leveled = f.category !== "all" || f.integration !== "all" || f.model !== "all";
  if (leveled && !u.devices.some((d) => (f.category === "all" || categoryOf(d.modelId).id === f.category) && (f.integration === "all" || integrationOf(d.modelId).id === f.integration) && (f.model === "all" || d.modelId === f.model))) return false;
  if (f.active === "today" && idleMs(u) > DAY_MS) return false;
  if (f.active === "7d" && idleMs(u) > 7 * DAY_MS) return false;
  if (f.active === "over7" && idleMs(u) <= 7 * DAY_MS) return false;
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
const stamp = (u: PortalUser) => (u.lastDeliveryAt ? Date.parse(u.lastDeliveryAt) : 0);
export const activeDevice = (u: PortalUser) => u.devices.find((d) => d.id === u.activeDeviceId) ?? null;

export function sortUsers(users: readonly PortalUser[], { key, dir }: Sort): PortalUser[] {
  const value = (u: PortalUser): number | string => {
    if (key === "name") return u.name;
    if (key === "devices") return u.devices.length;
    if (key === "active") return activeDevice(u)?.name ?? "";
    if (key === "delivery") return stamp(u);
    if (key === "success") return userDeliveries(u) ? userRate(u) : -1;
    return SEVERITY[statusOf(u)];
  };
  return [...users].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return order * dir || a.name.localeCompare(b.name);
  });
}

/** Online devices first, so the two a row shows are the two that matter. */
const RANK: Record<DeviceState, number> = { online: 0, needs_relink: 1, stale: 2, offline: 3 };
export const devicesInOrder = (u: PortalUser) => [...u.devices].sort((a, b) => RANK[a.state] - RANK[b.state]);

export function usersCsv(users: readonly PortalUser[]): string {
  const cell = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  const head = ["Name", "User ID", "Devices", "Active device", "Last delivery", "Delivered", "Status"];
  const rows = users.map((u) => [u.name, u.id, u.devices.length, activeDevice(u)?.name ?? "", u.lastDeliveryAt ?? "", userDeliveries(u) ? `${userRate(u)}%` : "", STATUS_LABELS[statusOf(u)]]);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}
