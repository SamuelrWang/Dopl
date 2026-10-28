/**
 * W0.1 "Dopl App" seed: idempotent convergence on one internal org, owner membership, project,
 * and one usable live + test secret key, over an in-memory store. Dry run never writes.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DOPL_APP_NAME, seedDoplApp, type DoplAppSeedStore, type SeedKey } from "./seed-dopl-app";
import type { Environment } from "../types";

const OWNER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-28T12:00:00Z");

interface KeyRow extends SeedKey {
  project_id: string;
  revoked: boolean;
  expires_at: Date | null;
}

function memoryStore() {
  const s = {
    orgs: [] as Array<{ id: string; owner: string; name: string; internal: boolean }>,
    members: [] as Array<{ org: string; user: string; role: string }>,
    projects: [] as Array<{ id: string; org: string; name: string }>,
    keys: [] as KeyRow[],
    writes: 0,
    seq: 0,
  };
  const id = (p: string) => `${p}-${++s.seq}`;
  const store: DoplAppSeedStore = {
    async findOrgs(owner, name) {
      return s.orgs.filter((o) => o.owner === owner && o.name === name).map(({ id, internal }) => ({ id, internal }));
    },
    async createInternalOrg(owner, name) {
      s.writes++;
      const o = { id: id("org"), owner, name, internal: true };
      s.orgs.push(o);
      return { id: o.id, internal: true };
    },
    async markOrgInternal(orgId) {
      s.writes++;
      s.orgs.find((o) => o.id === orgId)!.internal = true;
    },
    async hasOwnerMember(org, user) {
      return s.members.some((m) => m.org === org && m.user === user && m.role === "owner");
    },
    async addOwnerMember(org, user) {
      s.writes++;
      s.members = s.members.filter((m) => !(m.org === org && m.user === user));
      s.members.push({ org, user, role: "owner" });
    },
    async findProjects(org, name) {
      return s.projects.filter((p) => p.org === org && p.name === name).map(({ id }) => ({ id }));
    },
    async createProject(org, name) {
      s.writes++;
      const p = { id: id("proj"), org, name };
      s.projects.push(p);
      return { id: p.id };
    },
    async listUsableSecretKeys(projectId, env, now) {
      return s.keys
        .filter((k) => k.project_id === projectId && k.env === env && !k.revoked && (!k.expires_at || k.expires_at > now))
        .map(({ id, env, prefix }) => ({ id, env, prefix }));
    },
    async mintSecretKey(projectId, env: Environment) {
      s.writes++;
      const k: KeyRow = { id: id("key"), env, prefix: `sk_${env}_ABCD`, project_id: projectId, revoked: false, expires_at: null };
      s.keys.push(k);
      return { secret: `sk_${env}_EXAMPLE${k.id}`, key: { id: k.id, env, prefix: k.prefix } };
    },
  };
  return { s, store };
}

let mem: ReturnType<typeof memoryStore>;
beforeEach(() => {
  mem = memoryStore();
});

describe("seedDoplApp", () => {
  it("dry run on an empty db plans everything and writes nothing", async () => {
    const r = await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: false, now: NOW });
    expect(mem.s.writes).toBe(0);
    expect(r.applied).toBe(false);
    expect(r.orgId).toBeNull();
    expect(r.minted).toEqual([]);
    expect(r.steps.map((x) => x.action)).toEqual(["create", "create", "create", "mint", "mint"]);
  });

  it("apply creates an internal org, owner, project and one live + one test secret key", async () => {
    const r = await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW });
    expect(mem.s.orgs).toEqual([expect.objectContaining({ owner: OWNER, name: DOPL_APP_NAME, internal: true })]);
    expect(mem.s.members).toEqual([{ org: r.orgId, user: OWNER, role: "owner" }]);
    expect(mem.s.projects).toEqual([expect.objectContaining({ org: r.orgId, name: DOPL_APP_NAME })]);
    expect(r.minted.map((k) => k.env)).toEqual(["live", "test"]);
    expect(r.minted.every((k) => k.secret.startsWith(`sk_${k.env}_`))).toBe(true);
  });

  it("is idempotent: a second run writes nothing and mints nothing", async () => {
    const first = await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW });
    const writes = mem.s.writes;
    const second = await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW });
    expect(mem.s.writes).toBe(writes);
    expect(second.minted).toEqual([]);
    expect(second.orgId).toBe(first.orgId);
    expect(second.projectId).toBe(first.projectId);
    expect(second.kept.map((k) => k.env).sort()).toEqual(["live", "test"]);
    expect(second.steps.every((x) => x.action === "keep")).toBe(true);
    // The kept keys never carry a raw secret.
    expect(JSON.stringify(second)).not.toContain("EXAMPLE");
  });

  it("marks a pre-existing non-internal org internal and adds the missing owner row", async () => {
    mem.s.orgs.push({ id: "org-x", owner: OWNER, name: DOPL_APP_NAME, internal: false });
    mem.s.members.push({ org: "org-x", user: OWNER, role: "developer" });
    const r = await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW });
    expect(r.orgId).toBe("org-x");
    expect(mem.s.orgs[0].internal).toBe(true);
    expect(mem.s.members).toEqual([{ org: "org-x", user: OWNER, role: "owner" }]);
  });

  it("re-mints only the env whose keys are revoked or expired", async () => {
    await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW });
    mem.s.keys.find((k) => k.env === "live")!.revoked = true;
    mem.s.keys.find((k) => k.env === "test")!.expires_at = new Date(NOW.getTime() - 1);
    const r = await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW });
    expect(r.minted.map((k) => k.env)).toEqual(["live", "test"]);
    const again = await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW });
    expect(again.minted).toEqual([]);
  });

  it("keeps a key still inside its rotation overlap", async () => {
    await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW });
    for (const k of mem.s.keys) k.expires_at = new Date(NOW.getTime() + 60_000);
    const r = await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW });
    expect(r.minted).toEqual([]);
  });

  it("refuses to guess between duplicate orgs or projects", async () => {
    mem.s.orgs.push(
      { id: "a", owner: OWNER, name: DOPL_APP_NAME, internal: true },
      { id: "b", owner: OWNER, name: DOPL_APP_NAME, internal: true }
    );
    await expect(seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW })).rejects.toThrow(/2 orgs/);
    mem.s.orgs.pop();
    mem.s.members.push({ org: "a", user: OWNER, role: "owner" });
    mem.s.projects.push({ id: "p1", org: "a", name: DOPL_APP_NAME }, { id: "p2", org: "a", name: DOPL_APP_NAME });
    await expect(seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW })).rejects.toThrow(/2 projects/);
    expect(mem.s.writes).toBe(0);
  });

  it("ignores another owner's org of the same name", async () => {
    mem.s.orgs.push({ id: "other", owner: "22222222-2222-4222-8222-222222222222", name: DOPL_APP_NAME, internal: false });
    const r = await seedDoplApp(mem.store, { ownerUserId: OWNER, apply: true, now: NOW });
    expect(r.orgId).not.toBe("other");
    expect(mem.s.orgs.find((o) => o.id === "other")!.internal).toBe(false);
  });
});
