const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const ACTIVE_NOW_MS = 5 * 60 * 1000;

export type ActivityDot = "active" | "idle" | "invited" | "deactivated";

/**
 * Postgres DATE columns arrive as bare "YYYY-MM-DD" strings. Parsing
 * those with `new Date(iso)` lands on UTC midnight, which renders as
 * the PREVIOUS day for anyone west of UTC — so date-only strings are
 * constructed as local dates instead. Full ISO datetimes parse as-is.
 */
function parseDate(iso: string): Date {
  if (DATE_ONLY.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(iso);
}

/** "Jan 5, 2026" */
export function formatDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Jan 5" */
export function formatShortDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" / locale date. */
export function formatRelativeTime(iso: string | null | undefined): string {
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

/**
 * Last-active label + status dot from a throttled `lastSeenAt`
 * timestamp. Pending members show their invite age instead.
 */
export function formatLastActive(
  lastSeenAt: string | null,
  status: "active" | "pending" | "revoked",
  invitedAt?: string | null
): { label: string; dot: ActivityDot } {
  if (status === "pending") {
    return { label: `Invited ${formatRelativeTime(invitedAt)}`, dot: "invited" };
  }
  if (status === "revoked") {
    return { label: "Deactivated", dot: "deactivated" };
  }
  if (!lastSeenAt) return { label: "—", dot: "idle" };
  const ts = new Date(lastSeenAt).getTime();
  if (Number.isNaN(ts)) return { label: "—", dot: "idle" };
  if (Date.now() - ts < ACTIVE_NOW_MS) {
    return { label: "Active now", dot: "active" };
  }
  return { label: formatRelativeTime(lastSeenAt), dot: "idle" };
}
