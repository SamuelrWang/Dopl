import type { MemberStatus } from "./types";

export type ActivityDot = "active" | "idle" | "invited" | "deactivated";

const ACTIVE_NOW_MS = 5 * 60 * 1000;

/**
 * Format a member's last-active label + status dot from the throttled
 * `lastSeenAt` timestamp. Pending members show their invite age instead.
 */
export function formatLastActive(
  lastSeenAt: string | null,
  status: MemberStatus,
  invitedAt?: string | null
): { label: string; dot: ActivityDot } {
  if (status === "pending") {
    return { label: `Invited ${relative(invitedAt)}`, dot: "invited" };
  }
  if (status === "revoked") {
    return { label: "Deactivated", dot: "deactivated" };
  }
  if (!lastSeenAt) return { label: "—", dot: "idle" };
  const ts = new Date(lastSeenAt).getTime();
  if (Number.isNaN(ts)) return { label: "—", dot: "idle" };
  if (Date.now() - ts < ACTIVE_NOW_MS) return { label: "Active now", dot: "active" };
  return { label: relative(lastSeenAt), dot: "idle" };
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" / locale date. */
export function formatRelativeTime(iso: string | null | undefined): string {
  return relative(iso);
}

function relative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
