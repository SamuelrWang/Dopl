import type { AdapterRegistry } from "../../adapters/registry";
import type { ConnectPairingPort } from "@/features/glasses/core/devices/pairing";
import type { DeviceStore } from "@/features/glasses/core/devices/types";
import {
  ConnectBrandingSchema,
  ConnectSessionCreateRequestSchema,
  ConnectionExchangeRequestSchema,
  DEVICE_KINDS,
  ExternalUserIdSchema,
  type Connection,
  type ConnectSessionCreateResponse,
  type ConnectionExchangeResponse,
  type ConnectionListResponse,
} from "../../types";
import {
  CONNECT_SESSION_TTL_MS,
  CONNECT_TOKEN_PREFIX,
  ConnectError,
  hashToken,
  isUuid,
  newToken,
  toApiDevice,
  toConnection,
} from "./dto";
import type { ConnectSessionRow, ConnectStore, ConnectionRow, Tenant } from "./store-types";
import { enqueueWebhookEvent } from "./webhooks";

/**
 * THE DEVELOPER SIDE OF CONNECT (C2): the four `/v1` operations. The hosted page's side
 * (pre-check, pairing, consent) is `hosted.ts`. Every refusal is a {@link ConnectError}.
 */

export interface ConnectDeps {
  store: ConnectStore;
  adapters: AdapterRegistry;
  now?: () => number;
  /** G2 code pairing through the glasses pairing core (`claimPairingForConnect`). */
  glasses?: { devices: DeviceStore; port: ConnectPairingPort };
}

export const nowOf = (deps: ConnectDeps) => (deps.now ?? Date.now)();

/** The Zod issue, in one line. */
function invalid(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): ConnectError {
  const i = error.issues[0];
  const where = i?.path.length ? `${i.path.map(String).join(".")}: ` : "";
  return new ConnectError("invalid_request", `${where}${i?.message ?? "invalid body"}`);
}

/** Only http(s) redirects: a `javascript:` URL in a redirect is script injection. */
function safeRedirect(uri: string | undefined): string | null {
  if (!uri) return null;
  const { protocol } = new URL(uri);
  if (protocol !== "https:" && protocol !== "http:") {
    throw new ConnectError("invalid_request", "redirect_uri: must be an http(s) URL");
  }
  return uri;
}

/** `POST /v1/connect_sessions`. `origin` is the host that serves `/connect/{token}`. */
export async function createConnectSession(
  deps: ConnectDeps,
  tenant: Tenant,
  body: unknown,
  origin: string
): Promise<ConnectSessionCreateResponse> {
  const parsed = ConnectSessionCreateRequestSchema.safeParse(body);
  if (!parsed.success) throw invalid(parsed.error);
  const req = parsed.data;
  const redirect = safeRedirect(req.redirect_uri);

  const endUserId = await deps.store.upsertEndUser(tenant, req.external_user_id);
  // Branding snapshot: the project's saved branding, overridden per field by the request.
  const saved = ConnectBrandingSchema.safeParse(await deps.store.projectBranding(tenant.projectId));
  const branding = { ...(saved.success ? saved.data : {}), ...(req.branding ?? {}) };

  const token = newToken(CONNECT_TOKEN_PREFIX);
  const expiresAt = new Date(nowOf(deps) + CONNECT_SESSION_TTL_MS).toISOString();
  await deps.store.insertSession({
    project_id: tenant.projectId,
    env: tenant.env,
    end_user_id: endUserId,
    external_user_id: req.external_user_id,
    allowed_kinds: [...new Set(req.allowed_kinds ?? DEVICE_KINDS)],
    requested_scopes: [...new Set(req.requested_scopes)],
    redirect_uri: redirect,
    branding,
    token_hash: hashToken(token),
    expires_at: expiresAt,
  });
  return { connect_token: token, url: `${origin}/connect/${token}`, expires_at: expiresAt };
}

/** `POST /v1/connections/exchange` — one-time: a public token exchanges once, before it expires. */
export async function exchangePublicToken(
  deps: ConnectDeps,
  tenant: Tenant,
  body: unknown
): Promise<ConnectionExchangeResponse> {
  const parsed = ConnectionExchangeRequestSchema.safeParse(body);
  if (!parsed.success) throw invalid(parsed.error);
  const refused = new ConnectError("invalid_request", "public_token is invalid, expired or already exchanged.");
  const session = await deps.store.findSessionByPublicTokenHash(tenant, hashToken(parsed.data.public_token));
  if (!session || session.status !== "consented" || !session.connection_id) throw refused;
  if (!session.public_token_expires_at || Date.parse(session.public_token_expires_at) <= nowOf(deps)) throw refused;
  if (!(await deps.store.transitionSession(session.id, "consented", { status: "exchanged" }))) throw refused;

  const connection = await deps.store.getConnection(tenant, session.connection_id);
  const device = connection && (await deps.store.getDevice(connection.device_id));
  if (!connection || !device) throw new ConnectError("not_found", "The connection behind this public_token is gone.");
  return { connection_id: connection.id, device: await toApiDevice(device, deps.adapters) };
}

async function connectionDto(deps: ConnectDeps, row: ConnectionRow, externalUserId: string): Promise<Connection> {
  const device = await deps.store.getDevice(row.device_id);
  if (!device) throw new ConnectError("not_found", "The connection's device is gone.");
  return toConnection(row, device, externalUserId, deps.adapters);
}

/** `GET /v1/users/{external_user_id}/connections` — revoked connections included, as `revoked`. */
export async function listConnections(
  deps: ConnectDeps,
  tenant: Tenant,
  externalUserId: string
): Promise<ConnectionListResponse> {
  if (!ExternalUserIdSchema.safeParse(externalUserId).success) {
    throw new ConnectError("invalid_request", "external_user_id: must be 1–255 characters");
  }
  const endUserId = await deps.store.findEndUser(tenant, externalUserId);
  if (!endUserId) throw new ConnectError("not_found", "No end user with that external_user_id in this project and environment.");
  const rows = await deps.store.listConnections(tenant, endUserId);
  return { data: await Promise.all(rows.map((r) => connectionDto(deps, r, externalUserId))) };
}

/**
 * `DELETE /v1/connections/{id}` — idempotent: revoking a revoked connection answers it unchanged
 * and enqueues no second `connection.revoked`.
 */
export async function revokeConnection(
  deps: ConnectDeps,
  tenant: Tenant,
  id: string
): Promise<Connection> {
  const missing = new ConnectError("not_found", "No connection with that id in this project and environment.");
  if (!isUuid(id)) throw missing;
  const now = new Date(nowOf(deps));
  const revoked = await deps.store.revokeConnection(tenant, id, now.toISOString());
  const row = revoked ?? (await deps.store.getConnection(tenant, id));
  if (!row) throw missing;
  const externalUserId = await deps.store.externalUserIdOf(row.end_user_id);
  if (externalUserId === null) throw missing;
  const dto = await connectionDto(deps, row, externalUserId);
  if (revoked) await enqueueWebhookEvent(deps.store, tenant, "connection.revoked", dto as unknown as Record<string, unknown>, now);
  return dto;
}

/** The session behind a raw connect token, or null. */
export async function sessionByToken(deps: ConnectDeps, token: string): Promise<ConnectSessionRow | null> {
  if (!token.startsWith(CONNECT_TOKEN_PREFIX)) return null;
  return deps.store.findSessionByTokenHash(hashToken(token));
}

export const sessionExpired = (deps: ConnectDeps, s: ConnectSessionRow) => Date.parse(s.expires_at) <= nowOf(deps);
