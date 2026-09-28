import { HttpError } from "@/shared/lib/http-error";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ComputerDeviceDto } from "../types";
import type {
  DesktopDeviceRow,
  DesktopDeviceStore,
  DeviceTokenRow,
  HeartbeatInput,
} from "./desktop-devices-types";

/**
 * The computer source of Settings > Connect > Devices.
 *
 * A desktop heartbeats every ~60s while signed in (it rides the presence loop, which beats every
 * 30s and skips alternate sends), so a row is online while its last beat is inside this window and
 * it has not said `offline` (quit / sleep / lock post that at once).
 */
export const COMPUTER_ONLINE_WINDOW_MS = 150_000;

/** Address of a computer known only by a device token it minted before it could register. */
const LEGACY_PREFIX = "legacy-";
const LEGACY_LABEL = /^Dopl Desktop CLI(?: \((.+)\))?$/;

export interface DevicesDeps {
  store: DesktopDeviceStore;
  now?: () => number;
}

const nowIso = (deps: DevicesDeps) => new Date((deps.now ?? Date.now)()).toISOString();

export function isComputerOnline(
  row: Pick<DesktopDeviceRow, "last_seen" | "status">,
  now: number
): boolean {
  if (row.status === "offline" || row.last_seen === null) return false;
  return now - Date.parse(row.last_seen) <= COMPUTER_ONLINE_WINDOW_MS;
}

/** `Dopl Desktop CLI (Samuels-MacBook-Pro-2.local)` → `Samuels-MacBook-Pro-2`. */
export function legacyComputerName(label: string | null): string {
  const text = (label ?? "").trim();
  const match = LEGACY_LABEL.exec(text);
  if (!match) return text || "Computer";
  return (match[1] ?? "Computer").replace(/\.(local|lan)$/i, "") || "Computer";
}

function toDto(row: DesktopDeviceRow, now: number, installId: string | null): ComputerDeviceDto {
  return {
    id: row.id,
    kind: "computer",
    name: row.name,
    platform: row.platform,
    online: isComputerOnline(row, now),
    status: row.status,
    last_seen: row.last_seen,
    created_at: row.created_at,
    app_version: row.app_version,
    os_version: row.os_version,
    current: installId !== null && row.install_id === installId,
    legacy: false,
  };
}

/** One legacy row per label: the desktop keeps one live device token per label. */
function legacyDtos(tokens: DeviceTokenRow[]): ComputerDeviceDto[] {
  const byLabel = new Map<string, DeviceTokenRow>();
  for (const token of tokens) {
    if (token.device_id) continue;
    const label = token.client_name ?? "";
    const seen = byLabel.get(label);
    if (!seen || (token.last_used_at ?? "") > (seen.last_used_at ?? "")) byLabel.set(label, token);
  }
  return [...byLabel.values()].map((token) => ({
    id: `${LEGACY_PREFIX}${token.id}`,
    kind: "computer",
    name: legacyComputerName(token.client_name),
    platform: LEGACY_LABEL.test(token.client_name ?? "") ? "macos" : "",
    online: false,
    status: null,
    last_seen: token.last_used_at,
    created_at: token.created_at,
    app_version: null,
    os_version: null,
    current: false,
    legacy: true,
  }));
}

/** Registered computers (this one first, then most recently seen), then legacy ones. */
export async function listComputers(
  deps: DevicesDeps,
  userId: string,
  installId: string | null
): Promise<{ devices: ComputerDeviceDto[] }> {
  const now = (deps.now ?? Date.now)();
  const [rows, tokens] = await Promise.all([
    deps.store.listActive(userId),
    deps.store.listDeviceTokens(userId, new Date(now).toISOString()),
  ]);
  const registered = rows
    .map((row) => toDto(row, now, installId))
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        (b.last_seen ?? "").localeCompare(a.last_seen ?? "")
    );
  return { devices: [...registered, ...legacyDtos(tokens)] };
}

export type HeartbeatResult =
  | { device: { id: string; revoked: false } }
  | { device: { revoked: true } };

/**
 * Register or refresh this computer. A REMOVED computer stays removed: its heartbeat answers
 * `revoked`, the desktop signs out and mints a fresh install id, so its next sign-in is a new row.
 */
export async function heartbeat(
  deps: DevicesDeps,
  userId: string,
  input: HeartbeatInput
): Promise<HeartbeatResult> {
  const existing = await deps.store.findByInstall(userId, input.installId);
  if (existing?.revoked_at) return { device: { revoked: true } };
  const row = await deps.store.upsert(userId, input, nowIso(deps));
  if (input.tokenLabel) await deps.store.linkTokensByLabel(userId, row.id, input.tokenLabel);
  return { device: { id: row.id, revoked: false } };
}

const notFound = () => new HttpError(404, "DEVICE_NOT_FOUND", "No such device.");

/** Remove a computer: every credential it minted dies with it, container sessions included. */
export async function removeComputer(
  deps: DevicesDeps,
  userId: string,
  id: string
): Promise<{ ok: true; revokedTokens: number }> {
  const now = nowIso(deps);
  if (id.startsWith(LEGACY_PREFIX)) {
    const tokenId = id.slice(LEGACY_PREFIX.length);
    if (!isUuid(tokenId)) throw notFound();
    const revokedTokens = await deps.store.revokeLegacyToken(userId, tokenId, now);
    if (revokedTokens === 0) throw notFound();
    return { ok: true, revokedTokens };
  }
  if (!isUuid(id)) throw notFound();
  if (!(await deps.store.revoke(userId, id, now))) throw notFound();
  const revokedTokens = await deps.store.revokeLinkedTokens(userId, id, now);
  return { ok: true, revokedTokens };
}

/** The active computer a request came from, for stamping the credential it is minting. */
export async function resolveRequestDevice(
  deps: DevicesDeps,
  userId: string,
  installId: string | null
): Promise<string | null> {
  if (!installId || !isUuid(installId)) return null;
  const row = await deps.store.findByInstall(userId, installId);
  return row && !row.revoked_at ? row.id : null;
}
