/**
 * TEST FAKE — an in-memory {@link ConnectStore} mirroring `store.ts` semantics (tenant filters,
 * conditional session transitions, revoke-once). Token hashes are kept in a side map so a test can
 * assert they are hashes and never raw tokens. Not a `.test.ts`: suites import it.
 */
import { randomUUID } from "node:crypto";
import type { ConnectSessionRow, ConnectStore, ConnectionRow, DeviceRow, OutboxRow, Tenant } from "./store-types";

export function createFakeConnectStore() {
  const endUsers: Array<{ id: string; project_id: string; env: string; external_user_id: string }> = [];
  const sessions: Array<ConnectSessionRow & { token_hash: string; public_token_hash: string | null }> = [];
  const devices: DeviceRow[] = [];
  const connections: ConnectionRow[] = [];
  const outbox: OutboxRow[] = [];
  const branding = new Map<string, Record<string, unknown>>();
  const inTenant = (r: { project_id: string; env: string | null }, t: Tenant) => r.project_id === t.projectId && r.env === t.env;
  const strip = <T extends { token_hash?: string; public_token_hash?: string | null }>(r: T): ConnectSessionRow => {
    const copy = { ...r };
    delete copy.token_hash;
    delete copy.public_token_hash;
    return copy as unknown as ConnectSessionRow;
  };

  const store: ConnectStore = {
    async upsertEndUser(t, externalUserId) {
      const hit = endUsers.find((u) => inTenant(u, t) && u.external_user_id === externalUserId);
      if (hit) return hit.id;
      const row = { id: randomUUID(), project_id: t.projectId, env: t.env, external_user_id: externalUserId };
      endUsers.push(row);
      return row.id;
    },
    async findEndUser(t, externalUserId) {
      return endUsers.find((u) => inTenant(u, t) && u.external_user_id === externalUserId)?.id ?? null;
    },
    async externalUserIdOf(id) {
      return endUsers.find((u) => u.id === id)?.external_user_id ?? null;
    },
    async projectBranding(projectId) {
      return branding.get(projectId) ?? {};
    },
    async insertSession(s) {
      const row = {
        ...s,
        id: randomUUID(),
        status: "open" as const,
        device_id: null,
        connection_id: null,
        claim_attempts: 0,
        public_token_hash: null,
        public_token_expires_at: null,
        created_at: new Date().toISOString(),
      };
      sessions.push(row);
      return strip(row);
    },
    async findSessionByTokenHash(hash) {
      const s = sessions.find((x) => x.token_hash === hash);
      return s ? strip(s) : null;
    },
    async transitionSession(id, from, patch) {
      const s = sessions.find((x) => x.id === id && x.status === from);
      if (!s) return false;
      Object.assign(s, patch);
      return true;
    },
    async bumpClaimAttempts(id) {
      const s = sessions.find((x) => x.id === id)!;
      return ++s.claim_attempts;
    },
    async findSessionByPublicTokenHash(t, hash) {
      const s = sessions.find((x) => inTenant(x, t) && x.public_token_hash === hash);
      return s ? strip(s) : null;
    },
    async insertDevice(d) {
      const { now, ...rest } = d;
      const row: DeviceRow = { ...rest, id: randomUUID(), firmware: null, last_seen: now, created_at: now, revoked_at: null };
      devices.push(row);
      return { ...row };
    },
    async getDevice(id) {
      const d = devices.find((x) => x.id === id);
      return d ? { ...d } : null;
    },
    async revokeDevice(id, now) {
      const d = devices.find((x) => x.id === id && x.revoked_at === null);
      if (d) d.revoked_at = now;
    },
    async insertConnection(c) {
      const { now, ...rest } = c;
      const row: ConnectionRow = { ...rest, id: randomUUID(), status: "active", revoked_at: null, created_at: now };
      connections.push(row);
      return { ...row };
    },
    async getConnection(t, id) {
      const c = connections.find((x) => x.id === id && inTenant(x, t));
      return c ? { ...c } : null;
    },
    async listConnections(t, endUserId) {
      return connections.filter((x) => inTenant(x, t) && x.end_user_id === endUserId).map((c) => ({ ...c }));
    },
    async revokeConnection(t, id, now) {
      const c = connections.find((x) => x.id === id && inTenant(x, t) && x.revoked_at === null);
      if (!c) return null;
      Object.assign(c, { status: "revoked", revoked_at: now });
      return { ...c };
    },
    async insertOutbox(row) {
      outbox.push(row);
    },
  };

  return { store, endUsers, sessions, devices, connections, outbox, branding };
}
