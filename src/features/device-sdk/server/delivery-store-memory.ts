/**
 * IN-MEMORY delivery ports — the test double for `DeliveryStore` + `GrantStore`, with real filtering
 * (project/env isolation, revoked devices, the idempotency unique key) so suites exercise the rules
 * instead of assuming them. Not a `.test.ts`: suites import it.
 */
import { randomUUID } from "node:crypto";
import type { ContextProfile, Environment } from "../types";
import type { DeviceGrant } from "../delivery/policy";
import type { DeliveryStore, DeviceRow, GrantStore, NewAction, Scope, StoredAction } from "./delivery-store";

interface EndUser {
  id: string;
  project_id: string;
  env: Environment;
  external_user_id: string;
}

interface OwnedDevice extends DeviceRow {
  project_id: string;
  env: Environment;
  revoked: boolean;
}

export class MemoryDeliveryStore implements DeliveryStore {
  endUsers: EndUser[] = [];
  devices: OwnedDevice[] = [];
  profiles: Array<{ scope: Scope; profile: ContextProfile; active: boolean }> = [];
  actions: StoredAction[] = [];
  /** Simulated wall clock for `created_at` (tests drive the rate-limit window with it). */
  now: () => number = Date.now;

  addEndUser(scope: Scope, externalUserId: string, id: string = randomUUID()): string {
    this.endUsers.push({ id, project_id: scope.projectId, env: scope.env, external_user_id: externalUserId });
    return id;
  }

  addDevice(scope: Scope, d: Partial<DeviceRow> & Pick<DeviceRow, "kind" | "end_user_id">, revoked = false): OwnedDevice {
    const row: OwnedDevice = {
      id: d.id ?? randomUUID(),
      kind: d.kind,
      vendor: d.vendor ?? "dopl",
      model: d.model ?? `sim_${d.kind}`,
      firmware: d.firmware ?? null,
      adapter_id: d.adapter_id ?? "simulator",
      adapter_version: d.adapter_version ?? "0.1.0",
      end_user_id: d.end_user_id,
      last_seen: d.last_seen === undefined ? new Date(this.now()).toISOString() : d.last_seen,
      project_id: scope.projectId,
      env: scope.env,
      revoked,
    };
    this.devices.push(row);
    return row;
  }

  private inScope = (r: { project_id: string; env: Environment }, s: Scope) => r.project_id === s.projectId && r.env === s.env;
  private strip = (d: OwnedDevice): DeviceRow => ({
    id: d.id,
    kind: d.kind,
    vendor: d.vendor,
    model: d.model,
    firmware: d.firmware,
    adapter_id: d.adapter_id,
    adapter_version: d.adapter_version,
    end_user_id: d.end_user_id,
    last_seen: d.last_seen,
  });

  async findEndUser(scope: Scope, externalUserId: string) {
    const u = this.endUsers.find((e) => this.inScope(e, scope) && e.external_user_id === externalUserId);
    return u ? { id: u.id } : null;
  }
  async listDevices(scope: Scope, endUserId: string) {
    return this.devices.filter((d) => this.inScope(d, scope) && d.end_user_id === endUserId && !d.revoked).map(this.strip);
  }
  async getDevice(scope: Scope, deviceId: string) {
    const d = this.devices.find((x) => this.inScope(x, scope) && x.id === deviceId && !x.revoked);
    return d ? this.strip(d) : null;
  }
  async externalUserId(scope: Scope, endUserId: string) {
    return this.endUsers.find((e) => this.inScope(e, scope) && e.id === endUserId)?.external_user_id ?? null;
  }
  async listProfiles(scope: Scope) {
    return this.profiles
      .filter((p) => p.active && p.scope.projectId === scope.projectId && p.scope.env === scope.env)
      .map((p) => p.profile);
  }
  async findActionByKey(scope: Scope, key: string) {
    return this.actions.find((a) => this.inScope(a, scope) && a.idempotency_key === key) ?? null;
  }
  async insertAction(row: NewAction) {
    const existing = await this.findActionByKey({ projectId: row.project_id, env: row.env }, row.idempotency_key);
    if (existing) return { inserted: false as const, existing };
    const ts = new Date(this.now()).toISOString();
    const action: StoredAction = { ...row, id: row.id ?? randomUUID(), created_at: ts, updated_at: ts };
    this.actions.push(action);
    return { inserted: true as const, action };
  }
  async updateAction(scope: Scope, id: string, patch: Partial<StoredAction>) {
    const a = this.actions.find((x) => this.inScope(x, scope) && x.id === id);
    if (!a) return null;
    Object.assign(a, patch, { updated_at: new Date(this.now()).toISOString() });
    return a;
  }
  async getAction(scope: Scope, id: string) {
    return this.actions.find((a) => this.inScope(a, scope) && a.id === id) ?? null;
  }
  async countActionsSince(scope: Scope, sinceIso: string) {
    const since = Date.parse(sinceIso);
    return this.actions.filter((a) => this.inScope(a, scope) && Date.parse(a.created_at) >= since).length;
  }
}

export class MemoryGrantStore implements GrantStore {
  private grants = new Map<string, DeviceGrant>();
  private key = (projectId: string, env: Environment, endUserId: string, deviceId: string) => `${projectId}|${env}|${endUserId}|${deviceId}`;

  set(q: { projectId: string; env: Environment; endUserId: string; deviceId: string }, grant: DeviceGrant): void {
    this.grants.set(this.key(q.projectId, q.env, q.endUserId, q.deviceId), grant);
  }
  async load(q: { projectId: string; env: Environment; endUserId: string; deviceId: string }) {
    return this.grants.get(this.key(q.projectId, q.env, q.endUserId, q.deviceId)) ?? null;
  }
}
