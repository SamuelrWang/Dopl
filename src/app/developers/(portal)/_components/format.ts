/** Small display helpers. `since` reads the server's clock, set by the provider, so a render and its hydration agree. */
export const BASE = "/developers";

let clock = 0;

export function setPortalClock(iso: string): void {
  clock = Date.parse(iso);
}

export const portalNow = () => clock || Date.now();

export const fmt = (n: number) => n.toLocaleString("en-US");
export const ms = (n: number) => (n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);
export const clockOf = (iso: string) => `${iso.slice(5, 10)} ${iso.slice(11, 19)}`;

export function since(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const mins = Math.max(0, Math.round((portalNow() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function downloadCsv(name: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
