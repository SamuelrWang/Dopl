/**
 * The delivery layer's data PORTS (A5). Services depend on these interfaces only; the Supabase
 * implementations are `delivery-store-supabase.ts` / `grant-store.ts`, the in-memory ones
 * `delivery-store-memory.ts` (tests and the simulator end-to-end suite).
 */
import type { ActionStatus, ContextProfile, DeviceKind, Environment, ErrorBody, RouteDecision } from "../types";
import type { DeviceGrant } from "../delivery/policy";

export interface Scope {
  projectId: string;
  env: Environment;
}

/** A `devices` row owned by an SDK end user (the SDK owner shape). */
export interface DeviceRow {
  id: string;
  kind: DeviceKind;
  vendor: string;
  model: string;
  firmware: string | null;
  adapter_id: string;
  adapter_version: string;
  end_user_id: string;
  last_seen: string | null;
}

export interface StoredAction {
  id: string;
  project_id: string;
  env: Environment;
  end_user_id: string | null;
  device_id: string | null;
  source: "deliver" | "action";
  capability: string | null;
  intent: string | null;
  status: ActionStatus;
  idempotency_key: string;
  request_hash: string;
  http_status: number;
  /** The exact response body a replay returns. */
  response: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: ErrorBody | null;
  route_decision: RouteDecision | null;
  /** When the device took it. Written, not in `ACTION_COLS`: nothing on a delivery path reads it. */
  delivered_at?: string | null;
  /** When it reached `done` or `failed`. */
  settled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type NewAction = Omit<StoredAction, "id" | "created_at" | "updated_at"> & { id?: string };
export type ActionPatch = Partial<Pick<StoredAction, "status" | "result" | "error" | "response" | "http_status" | "delivered_at" | "settled_at">>;

/** The timestamps a status earns when an action first reaches it. */
export function actionTimes(status: ActionStatus, at: string): Pick<ActionPatch, "delivered_at" | "settled_at"> {
  if (status === "delivered") return { delivered_at: at };
  if (status === "done") return { delivered_at: at, settled_at: at };
  if (status === "failed") return { settled_at: at };
  return {};
}

export interface DeliveryStore {
  /** `dev_end_users.id` for the developer's external user id, or null. */
  findEndUser(scope: Scope, externalUserId: string): Promise<{ id: string } | null>;
  /** The end user's live (not revoked) devices. */
  listDevices(scope: Scope, endUserId: string): Promise<DeviceRow[]>;
  /** One live device of this project + env, or null (another project's device is null too). */
  getDevice(scope: Scope, deviceId: string): Promise<DeviceRow | null>;
  /** External id of an end user (for event rows). */
  externalUserId(scope: Scope, endUserId: string): Promise<string | null>;
  /** Active project profiles, every version (the resolver picks). Invalid rows are skipped. */
  listProfiles(scope: Scope): Promise<ContextProfile[]>;
  findActionByKey(scope: Scope, key: string): Promise<StoredAction | null>;
  /** Insert; on a unique-key race returns the row that won instead. */
  insertAction(row: NewAction): Promise<{ inserted: true; action: StoredAction } | { inserted: false; existing: StoredAction }>;
  updateAction(scope: Scope, id: string, patch: ActionPatch): Promise<StoredAction | null>;
  getAction(scope: Scope, id: string): Promise<StoredAction | null>;
  countActionsSince(scope: Scope, sinceIso: string): Promise<number>;
}

export interface GrantLookup extends Scope {
  endUserId: string;
  deviceId: string;
}

/** C7 end-user grants (A4's `connections`). */
export interface GrantStore {
  load(q: GrantLookup): Promise<DeviceGrant | null>;
}
