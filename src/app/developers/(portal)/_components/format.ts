/** Small display helpers. `since` reads the server's clock, set by the provider, so a render and its hydration agree. */
export const BASE = "/developers";
export const PROJECT_COOKIE = "dopl_dev_project";
export const ENV_COOKIE = "dopl_dev_env";

const YEAR_S = 365 * 86_400;

/** The chosen project or environment, for `loadScope` to read. Call from the browser. */
export function writePortalCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/developers; max-age=${YEAR_S}; samesite=lax`;
}

let clock = 0;

export function setPortalClock(iso: string): void {
  clock = Date.parse(iso);
}

export const portalNow = () => clock || Date.now();

export const fmt = (n: number) => n.toLocaleString("en-US");
export const ms = (n: number) => (n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);
export const clockOf = (iso: string) => `${iso.slice(5, 10)} ${iso.slice(11, 19)} UTC`;

export function since(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const mins = Math.max(0, Math.round((portalNow() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/** Quoted, and a leading formula character neutered: a device's message must not run as a spreadsheet formula. */
function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  return `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
}

export function downloadCsv(name: string, rows: readonly (readonly (string | number)[])[]): void {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
