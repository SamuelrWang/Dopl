import { createHash, randomBytes } from "node:crypto";
import type { AdapterRegistry } from "../../adapters/registry";
import type { Connection, Device, Environment, ErrorCode } from "../../types";
import type { ConnectionRow, DeviceRow } from "./store-types";

/**
 * Connect tokens, the Connect error, and row → contract mapping (C2 `Connection`, C3 `Device`).
 *
 * ⚠ RAW TOKENS ARE NEVER STORED: `hashToken` (sha256 hex) is what lands in
 * `connect_sessions.token_hash` / `public_token_hash`. The raw connect token goes to the developer
 * once (in the hosted URL); the raw public token goes to the redirect once.
 */

/** How long a Connect session (the hosted URL) lives. */
export const CONNECT_SESSION_TTL_MS = 30 * 60 * 1000;
/** How long the developer has to exchange a public token. */
export const PUBLIC_TOKEN_TTL_MS = 30 * 60 * 1000;
/** Wrong pairing codes tolerated on one session before it stops accepting claims. */
export const MAX_CLAIM_ATTEMPTS = 10;

export const CONNECT_TOKEN_PREFIX = "ct_";
export const publicTokenPrefix = (env: Environment) => `public-${env}-`;

/** 24 random bytes, base64url (32 URL-safe chars) after the prefix. */
export function newToken(prefix: string): string {
  return prefix + randomBytes(24).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** A refusal in the C10 vocabulary; the route turns it into `devSdkError(code, message)`. */
export class ConnectError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

/** Postgres answers `…+00:00`; the contracts' `z.iso.datetime()` wants `…Z`. */
export const isoOf = (t: string): string => new Date(t).toISOString();
const isoOrNull = (t: string | null): string | null => (t === null ? null : isoOf(t));

/** A `devices` row as the API returns it: descriptors and health come from its adapter (C9). */
export async function toApiDevice(row: DeviceRow, adapters: AdapterRegistry): Promise<Device> {
  const base: Device = {
    id: row.id,
    kind: row.kind,
    vendor: row.vendor,
    model: row.model,
    firmware: row.firmware,
    adapter_id: row.adapter_id,
    adapter_version: row.adapter_version,
    capabilities: [],
    online: false,
    last_seen_at: isoOrNull(row.last_seen),
  };
  const adapter = adapters.get(row.adapter_id);
  if (!adapter) return base;
  const capabilities = adapter.describe(base);
  const online = row.revoked_at === null && (await adapter.health(base)).online;
  return { ...base, capabilities, online };
}

export async function toConnection(
  row: ConnectionRow,
  device: DeviceRow,
  externalUserId: string,
  adapters: AdapterRegistry
): Promise<Connection> {
  const grantedAt = isoOf(row.created_at);
  return {
    id: row.id,
    external_user_id: externalUserId,
    status: row.status,
    device: await toApiDevice(device, adapters),
    grants: row.granted_scopes.map((scope) => ({
      scope: scope as Connection["grants"][number]["scope"],
      granted_at: grantedAt,
      expires_at: isoOrNull(row.expires_at),
    })),
    created_at: grantedAt,
    revoked_at: isoOrNull(row.revoked_at),
  };
}
