/**
 * Developer portal display helpers. Pure. Relative times are computed on the SERVER against one
 * `now` per request and handed to client components as strings, so nothing re-renders differently
 * on hydration.
 */

/** "3m ago" / "2d ago" / "in 4h" from `now`. `null` reads "Never". */
export function since(iso: string | null, now: Date): string {
  if (!iso) return "Never";
  const diff = now.getTime() - Date.parse(iso);
  const future = diff < 0;
  const m = Math.abs(diff) / 60_000;
  if (m < 1) return "Just now";
  const word = m < 60 ? `${Math.round(m)}m` : m < 60 * 24 ? `${Math.round(m / 60)}h` : `${Math.round(m / (60 * 24))}d`;
  return future ? `in ${word}` : `${word} ago`;
}

/** `10-28 14:05:09` (UTC), the log's time column. */
export function clock(iso: string): string {
  return iso.slice(5, 10) + " " + iso.slice(11, 19);
}

export const KIND_LABEL: Record<string, string> = {
  glasses: "Glasses",
  phone: "Phone",
  desktop: "Desktop",
  watch: "Watch",
  home_hub: "Home hub",
  home_device: "Home device",
  vehicle: "Vehicle",
  robot: "Robot",
};

export const OUTCOME_LABEL: Record<string, string> = { ok: "OK", error: "Error", denied: "Denied" };

/** A key as the table shows it: the stored prefix, then a fixed mask. */
export function maskedKey(prefix: string): string {
  return `${prefix}${"•".repeat(12)}`;
}
