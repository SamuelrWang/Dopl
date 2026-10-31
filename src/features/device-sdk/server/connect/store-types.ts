/**
 * Every DB operation the Connect flow needs (`store.ts` is the service-role implementation;
 * `fake-connect-store.ts` the in-memory one tests drive). Tokens cross this boundary as HASHES only.
 */
import type { DeviceKind, Environment, RiskTier, WebhookEventName } from "../../types";

type ConnectSessionStatus = "open" | "paired" | "consented" | "exchanged";

export interface ConnectSessionRow {
  id: string;
  project_id: string;
  env: Environment;
  end_user_id: string;
  external_user_id: string;
  allowed_kinds: DeviceKind[];
  requested_scopes: string[];
  redirect_uri: string | null;
  branding: Record<string, unknown>;
  status: ConnectSessionStatus;
  device_id: string | null;
  connection_id: string | null;
  claim_attempts: number;
  public_token_expires_at: string | null;
  expires_at: string;
  created_at: string;
}

/** A `devices` row (A3), SDK owner shape. */
export interface DeviceRow {
  id: string;
  kind: DeviceKind;
  vendor: string;
  model: string;
  firmware: string | null;
  adapter_id: string;
  adapter_version: string;
  display_name: string;
  project_id: string | null;
  env: Environment | null;
  end_user_id: string | null;
  last_seen: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ConnectionRow {
  id: string;
  project_id: string;
  env: Environment;
  end_user_id: string;
  device_id: string;
  granted_scopes: string[];
  tier_grants: Record<string, RiskTier>;
  status: "active" | "needs_reauth" | "revoked";
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface NewSession {
  project_id: string;
  env: Environment;
  end_user_id: string;
  external_user_id: string;
  allowed_kinds: DeviceKind[];
  requested_scopes: string[];
  redirect_uri: string | null;
  branding: Record<string, unknown>;
  token_hash: string;
  expires_at: string;
}

interface NewSdkDevice {
  kind: DeviceKind;
  vendor: string;
  model: string;
  adapter_id: string;
  adapter_version: string;
  display_name: string;
  project_id: string;
  env: Environment;
  end_user_id: string;
  now: string;
}

export interface OutboxRow {
  /** Chosen by the writer so the payload can carry `evt_<id>`. */
  id: string;
  project_id: string;
  env: Environment;
  event_type: WebhookEventName;
  payload: Record<string, unknown>;
}

export interface Tenant {
  projectId: string;
  env: Environment;
}

export interface ConnectStore {
  /** Upsert by (project, env, external_user_id); returns the row id. */
  upsertEndUser(t: Tenant, externalUserId: string): Promise<string>;
  findEndUser(t: Tenant, externalUserId: string): Promise<string | null>;
  /** `dev_end_users.external_user_id` of an end-user row, or null. */
  externalUserIdOf(endUserId: string): Promise<string | null>;
  /** `dev_projects.branding` ({} when unset). */
  projectBranding(projectId: string): Promise<Record<string, unknown>>;

  insertSession(s: NewSession): Promise<ConnectSessionRow>;
  findSessionByTokenHash(hash: string): Promise<ConnectSessionRow | null>;
  /**
   * Conditional update: applies `patch` only while the row is in `from` status (and, when given,
   * still has `device_id` = `deviceId`). `true` only for the one caller that won.
   */
  transitionSession(
    id: string,
    from: ConnectSessionStatus,
    patch: Partial<Pick<ConnectSessionRow, "status" | "device_id" | "connection_id" | "public_token_expires_at">> & {
      public_token_hash?: string;
    }
  ): Promise<boolean>;
  /** +1 on `claim_attempts`; returns the new count. */
  bumpClaimAttempts(id: string): Promise<number>;
  /** The session holding this public-token hash, in this tenant. */
  findSessionByPublicTokenHash(t: Tenant, hash: string): Promise<ConnectSessionRow | null>;

  insertDevice(d: NewSdkDevice): Promise<DeviceRow>;
  getDevice(id: string): Promise<DeviceRow | null>;
  /** Revoke a device created for a claim that lost its race (no orphans). */
  revokeDevice(id: string, now: string): Promise<void>;

  insertConnection(c: Omit<ConnectionRow, "id" | "status" | "revoked_at" | "created_at"> & { now: string }): Promise<ConnectionRow>;
  getConnection(t: Tenant, id: string): Promise<ConnectionRow | null>;
  listConnections(t: Tenant, endUserId: string): Promise<ConnectionRow[]>;
  /** active|needs_reauth → revoked; null when nothing changed (unknown or already revoked). */
  revokeConnection(t: Tenant, id: string, now: string): Promise<ConnectionRow | null>;

  insertOutbox(row: OutboxRow): Promise<void>;
}
