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

/** What a computer is called: the user's rename, else the detected name. */
export const computerName = (row: Pick<DesktopDeviceRow, "name" | "display_name">): string =>
  row.display_name || row.name;

function toDto(row: DesktopDeviceRow, now: number, installId: string | null): ComputerDeviceDto {
  return {
    id: row.id,
    kind: "computer",
    name: computerName(row),
    detected_name: row.name,
    renamed: !!row.display_name,
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

/** One legacy row per unlinked device token (the desktop keeps one live token per label). */
function legacyDtos(tokens: DeviceTokenRow[]): ComputerDeviceDto[] {
  return tokens
    .filter((token) => !token.device_id)
    .map((token) => ({
      id: `${LEGACY_PREFIX}${token.id}`,
      kind: "computer",
      name: legacyComputerName(token.client_name),
      detected_name: legacyComputerName(token.client_name),
      renamed: false,
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
 * Register or refresh this computer: ONE update in the common case (the row exists and is active).
 * A REMOVED computer stays removed: its heartbeat answers `revoked`, the desktop signs out and mints
 * a fresh install id, so its next sign-in is a new row. A token is linked only when the beat names
 * one (the desktop sends it once after sign-in or a re-mint).
 */
export async function heartbeat(
  deps: DevicesDeps,
  userId: string,
  input: HeartbeatInput,
  sessionId: string | null = null
): Promise<HeartbeatResult> {
  const now = nowIso(deps);
  let row = await deps.store.touch(userId, input, sessionId, now);
  if (!row) {
    const existing = await deps.store.findByInstall(userId, input.installId);
    if (existing?.revoked_at) return { device: { revoked: true } };
    row =
      (await deps.store.insert(userId, input, sessionId, now)) ??
      (await deps.store.touch(userId, input, sessionId, now));
    if (!row) return { device: { revoked: true } };
  }
  if (input.tokenId) await deps.store.linkTokenById(userId, row.id, input.tokenId);
  else if (input.tokenLabel) await deps.store.linkTokensByLabel(userId, row.id, input.tokenLabel);
  return { device: { id: row.id, revoked: false } };
}

const notFound = () => new HttpError(404, "DEVICE_NOT_FOUND", "No such device.");

/**
 * Rename a computer (Settings > Connect > Devices). The rename is an override column, so the
 * heartbeat's detected name keeps updating underneath it; a blank or null name clears the
 * override and the detected name shows again. A legacy computer (a token, no row) cannot be renamed.
 */
export async function renameComputer(
  deps: DevicesDeps,
  userId: string,
  id: string,
  name: string | null,
  installId: string | null = null
): Promise<{ device: ComputerDeviceDto }> {
  if (!isUuid(id)) throw notFound();
  const row = await deps.store.setDisplayName(userId, id, name?.trim() || null);
  if (!row) throw notFound();
  return { device: toDto(row, (deps.now ?? Date.now)(), installId) };
}

/**
 * Remove a computer: every credential it minted is revoked (container sessions included) and its
 * Supabase sign-in is ended server-side, so it cannot refresh. What survives is in docs/devices.md.
 */
export async function removeComputer(
  deps: DevicesDeps,
  userId: string,
  id: string
): Promise<{ ok: true; revokedTokens: number; endedSession: boolean }> {
  const now = nowIso(deps);
  if (id.startsWith(LEGACY_PREFIX)) {
    const tokenId = id.slice(LEGACY_PREFIX.length);
    if (!isUuid(tokenId)) throw notFound();
    const revokedTokens = await deps.store.revokeLegacyToken(userId, tokenId, now);
    if (revokedTokens === 0) throw notFound();
    return { ok: true, revokedTokens, endedSession: false };
  }
  if (!isUuid(id)) throw notFound();
  const row = await deps.store.revoke(userId, id, now);
  if (!row) throw notFound();
  const revokedTokens = await deps.store.revokeLinkedTokens(userId, id, now);
  const endedSession = row.auth_session_id
    ? await deps.store.endAuthSession(userId, row.auth_session_id)
    : false;
  return { ok: true, revokedTokens, endedSession };
}

export type RequestDevice = { deviceId: string } | { removed: true } | null;

/** The ACTIVE registered computer behind a request (no header, unknown or removed = null). */
export async function requestComputer(
  deps: DevicesDeps,
  userId: string,
  installId: string | null
): Promise<DesktopDeviceRow | null> {
  if (!installId || !isUuid(installId)) return null;
  const row = await deps.store.findByInstall(userId, installId);
  return row && !row.revoked_at ? row : null;
}

/** The computer a request came from: active, removed, or unknown (no header / not registered). */
export async function resolveRequestDevice(
  deps: DevicesDeps,
  userId: string,
  installId: string | null
): Promise<RequestDevice> {
  if (!installId || !isUuid(installId)) return null;
  const row = await deps.store.findByInstall(userId, installId);
  if (!row) return null;
  return row.revoked_at ? { removed: true } : { deviceId: row.id };
}
