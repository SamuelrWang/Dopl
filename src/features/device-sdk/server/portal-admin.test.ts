/**
 * Portal self-serve writes (P3) against the in-memory `fake-portal-db` (filters, unique keys and
 * the one-open-invite index applied for real). The properties that fail quietly:
 *  - 🔒 REACH: a target outside the caller's orgs is 404, never a write;
 *  - 🔒 ROLES ONLY GO DOWN: admin cannot grant admin, cannot touch an admin; nobody re-roles or
 *    removes the owner; a developer manages nothing;
 *  - 🔒 INVITES: token stored hashed, raw returned once; accept needs the confirmed matching
 *    email; one invite → one membership; a failed member write releases the claim; joining never
 *    lowers a role;
 *  - 🔒 KEYS: owner/admin only, active-key cap, raw key returned once, revoke is 404 off-reach.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/shared/supabase/admin", async () => {
  const { fakePortalDb } = await import("./fake-portal-db");
  return { supabaseAdmin: () => fakePortalDb };
});

import { fakePortal, resetFakePortal, rows, seed } from "./fake-portal-db";
import {
  MAX_ACTIVE_KEYS,
  MAX_OWNED_ORGS,
  changeMemberRole,
  createOrgWithProject,
  createProject,
  createProjectKey,
  listOrgMembers,
  removeMember,
  revokeProjectKey,
} from "./portal-admin";
import { acceptInvite, createInvite, getInviteForToken, hashInviteToken, listOrgInvites, revokeInvite } from "./portal-invites";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const DEV = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";

let orgId = "";
let projectId = "";

function user(id: string, email: string, confirmed = true) {
  fakePortal.users.set(id, { id, email, email_confirmed_at: confirmed ? "2026-10-01T00:00:00.000Z" : null });
}

async function expectHttp(p: Promise<unknown>, status: number, code?: string) {
  await expect(p).rejects.toMatchObject(code ? { status, code } : { status });
}

beforeEach(() => {
  resetFakePortal();
  user(OWNER, "owner@example.com");
  user(ADMIN, "admin@example.com");
  user(DEV, "dev@example.com");
  user(STRANGER, "stranger@example.com");
  orgId = seed("dev_orgs", { name: "Acme", owner_user_id: OWNER }).id as string;
  projectId = seed("dev_projects", { org_id: orgId, name: "Acme app" }).id as string;
  seed("dev_org_members", { org_id: orgId, user_id: ADMIN, role: "admin" });
  seed("dev_org_members", { org_id: orgId, user_id: DEV, role: "developer" });
});

describe("createOrgWithProject", () => {
  it("creates an org owned by the caller with its first project", async () => {
    const out = await createOrgWithProject(STRANGER, { orgName: "  New   Co ", projectName: "App" });
    const org = rows("dev_orgs").find((o) => o.id === out.orgId);
    expect(org).toMatchObject({ name: "New Co", owner_user_id: STRANGER, internal: false });
    expect(rows("dev_projects").find((p) => p.id === out.projectId)).toMatchObject({ org_id: out.orgId, name: "App" });
  });

  it("refuses blank names and the owned-org cap", async () => {
    await expectHttp(createOrgWithProject(STRANGER, { orgName: " ", projectName: "x" }), 400);
    for (let i = 0; i < MAX_OWNED_ORGS; i++) seed("dev_orgs", { name: `o${i}`, owner_user_id: STRANGER });
    await expectHttp(createOrgWithProject(STRANGER, { orgName: "one more", projectName: "x" }), 409, "ORG_LIMIT");
  });

  it("deletes the org again when the project insert fails", async () => {
    fakePortal.failNextInsert.add("dev_projects");
    await expect(createOrgWithProject(STRANGER, { orgName: "Half", projectName: "x" })).rejects.toThrow();
    expect(rows("dev_orgs").some((o) => o.name === "Half")).toBe(false);
  });
});

describe("createProject", () => {
  it("owner and admin create; developer is 403; a stranger is 404", async () => {
    await createProject(OWNER, orgId, { name: "Two" });
    await createProject(ADMIN, orgId, { name: "Three" });
    await expectHttp(createProject(DEV, orgId, { name: "x" }), 403);
    await expectHttp(createProject(STRANGER, orgId, { name: "x" }), 404);
    expect(rows("dev_projects").filter((p) => p.org_id === orgId)).toHaveLength(3);
  });
});

describe("members", () => {
  it("lists the owner first with emails, for any role; 404 for a stranger", async () => {
    const list = await listOrgMembers(DEV, orgId);
    expect(list.map((m) => [m.email, m.role, m.isOwner])).toEqual([
      ["owner@example.com", "owner", true],
      ["admin@example.com", "admin", false],
      ["dev@example.com", "developer", false],
    ]);
    await expectHttp(listOrgMembers(STRANGER, orgId), 404);
  });

  it("🔒 owner promotes a developer; admin cannot grant admin or touch an admin", async () => {
    await expectHttp(changeMemberRole(ADMIN, orgId, DEV, "admin"), 403);
    await expectHttp(changeMemberRole(ADMIN, orgId, ADMIN, "developer"), 403);
    await changeMemberRole(OWNER, orgId, DEV, "admin");
    expect(rows("dev_org_members").find((m) => m.user_id === DEV)?.role).toBe("admin");
    await expectHttp(changeMemberRole(OWNER, orgId, DEV, "owner"), 403);
  });

  it("🔒 nobody re-roles or removes the owner", async () => {
    await expectHttp(changeMemberRole(OWNER, orgId, OWNER, "admin"), 403);
    await expectHttp(removeMember(ADMIN, orgId, OWNER), 403);
    await expectHttp(removeMember(OWNER, orgId, OWNER), 403);
  });

  it("admin removes a developer; developer removes nobody but can leave", async () => {
    await expectHttp(removeMember(DEV, orgId, ADMIN), 403);
    await removeMember(DEV, orgId, DEV);
    expect(rows("dev_org_members").some((m) => m.user_id === DEV)).toBe(false);
    seed("dev_org_members", { org_id: orgId, user_id: DEV, role: "developer" });
    await removeMember(ADMIN, orgId, DEV);
    expect(rows("dev_org_members").some((m) => m.user_id === DEV)).toBe(false);
  });
});

describe("invites", () => {
  it("🔒 stores only the token hash and returns the raw token once", async () => {
    const { token, invite } = await createInvite(OWNER, orgId, { email: " New@Example.com ", role: "admin" });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = rows("dev_org_invites").find((r) => r.id === invite.id)!;
    expect(row).toMatchObject({ email: "new@example.com", role: "admin", token_hash: hashInviteToken(token), invited_by: OWNER });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("🔒 admin invites developers only; developer invites nobody; stranger 404", async () => {
    await expectHttp(createInvite(ADMIN, orgId, { email: "a@example.com", role: "admin" }), 403);
    await createInvite(ADMIN, orgId, { email: "a@example.com", role: "developer" });
    await expectHttp(createInvite(DEV, orgId, { email: "b@example.com", role: "developer" }), 403);
    await expectHttp(createInvite(STRANGER, orgId, { email: "b@example.com", role: "developer" }), 404);
    await expectHttp(createInvite(OWNER, orgId, { email: "c@example.com", role: "owner" }), 403);
    await expectHttp(createInvite(OWNER, orgId, { email: "not-an-email", role: "developer" }), 400);
  });

  it("refuses a second open invite for the same email, but replaces an expired one", async () => {
    const t0 = new Date("2026-10-28T00:00:00.000Z");
    await createInvite(OWNER, orgId, { email: "x@example.com", role: "developer" }, t0);
    await expectHttp(createInvite(OWNER, orgId, { email: "x@example.com", role: "developer" }, t0), 409, "INVITE_EXISTS");
    const later = new Date(t0.getTime() + 8 * 86_400_000);
    await createInvite(OWNER, orgId, { email: "x@example.com", role: "developer" }, later);
    const open = rows("dev_org_invites").filter((r) => r.email === "x@example.com" && r.revoked_at == null);
    expect(open).toHaveLength(1);
  });

  it("lists open invites for owner/admin; 403 for developer", async () => {
    await createInvite(OWNER, orgId, { email: "x@example.com", role: "developer" });
    expect((await listOrgInvites(ADMIN, orgId)).map((i) => i.email)).toEqual(["x@example.com"]);
    await expectHttp(listOrgInvites(DEV, orgId), 403);
  });

  it("🔒 revoke: off-reach 404, developer 403, then the token stops working", async () => {
    const { token, invite } = await createInvite(OWNER, orgId, { email: "stranger@example.com", role: "developer" });
    await expectHttp(revokeInvite(STRANGER, invite.id), 404);
    await expectHttp(revokeInvite(DEV, invite.id), 403);
    await revokeInvite(ADMIN, invite.id);
    expect((await getInviteForToken(token))?.state).toBe("revoked");
    await expectHttp(acceptInvite(STRANGER, token), 410, "INVITE_REVOKED");
  });

  it("🔒 accept needs the confirmed, matching email", async () => {
    const { token } = await createInvite(OWNER, orgId, { email: "stranger@example.com", role: "developer" });
    await expectHttp(acceptInvite(DEV, token), 403, "INVITE_EMAIL_MISMATCH");
    user(STRANGER, "Stranger@Example.com", false);
    await expectHttp(acceptInvite(STRANGER, token), 403, "EMAIL_UNCONFIRMED");
    user(STRANGER, "Stranger@Example.com", true);
    expect(await acceptInvite(STRANGER, token)).toEqual({ orgId });
    expect(rows("dev_org_members").find((m) => m.user_id === STRANGER)?.role).toBe("developer");
  });

  it("🔒 one invite yields one membership; the same user re-accepting is a no-op", async () => {
    const { token } = await createInvite(OWNER, orgId, { email: "stranger@example.com", role: "developer" });
    await acceptInvite(STRANGER, token);
    expect(await acceptInvite(STRANGER, token)).toEqual({ orgId });
    user(DEV, "stranger@example.com");
    await expectHttp(acceptInvite(DEV, token), 410, "INVITE_ACCEPTED");
  });

  it("🔒 an expired invite is refused", async () => {
    const t0 = new Date("2026-10-28T00:00:00.000Z");
    const { token } = await createInvite(OWNER, orgId, { email: "stranger@example.com", role: "developer" }, t0);
    await expectHttp(acceptInvite(STRANGER, token, new Date(t0.getTime() + 8 * 86_400_000)), 410, "INVITE_EXPIRED");
  });

  it("🔒 a failed membership write releases the claim so a retry works", async () => {
    const { token } = await createInvite(OWNER, orgId, { email: "stranger@example.com", role: "developer" });
    fakePortal.failNextInsert.add("dev_org_members");
    await expect(acceptInvite(STRANGER, token)).rejects.toThrow();
    expect((await getInviteForToken(token))?.state).toBe("open");
    await acceptInvite(STRANGER, token);
    expect(rows("dev_org_members").some((m) => m.user_id === STRANGER)).toBe(true);
  });

  it("🔒 joining never lowers a role", async () => {
    const { token } = await createInvite(OWNER, orgId, { email: "admin@example.com", role: "developer" });
    await acceptInvite(ADMIN, token);
    expect(rows("dev_org_members").find((m) => m.user_id === ADMIN)?.role).toBe("admin");
  });

  it("an unknown or malformed token is null", async () => {
    expect(await getInviteForToken("nope")).toBeNull();
    expect(await getInviteForToken("A".repeat(43))).toBeNull();
  });
});

describe("keys", () => {
  it("owner mints a secret key once; developer 403; stranger 404; bad env 400", async () => {
    const minted = await createProjectKey(OWNER, projectId, { env: "live", kind: "secret" });
    expect(minted.secret).toMatch(/^sk_live_/);
    const stored = rows("dev_api_keys").find((k) => k.id === minted.key.id)!;
    expect(JSON.stringify(stored)).not.toContain(minted.secret);
    expect(minted.key).not.toHaveProperty("key_hash");
    await expectHttp(createProjectKey(DEV, projectId, { env: "test", kind: "secret" }), 403);
    await expectHttp(createProjectKey(STRANGER, projectId, { env: "test", kind: "secret" }), 404);
    await expectHttp(createProjectKey(OWNER, projectId, { env: "prod", kind: "secret" }), 400);
  });

  it("publishable keys carry connect only", async () => {
    const minted = await createProjectKey(ADMIN, projectId, { env: "test", kind: "publishable" });
    expect(minted.secret).toMatch(/^pk_/);
    expect(minted.key.scopes).toEqual(["connect"]);
  });

  it("caps active keys per project and env; revoked and expired keys do not count", async () => {
    for (let i = 0; i < MAX_ACTIVE_KEYS - 1; i++) {
      seed("dev_api_keys", { project_id: projectId, env: "test", kind: "secret", prefix: "sk_test_x", key_hash: `${i}`.padStart(64, "0"), scopes: ["connect"] });
    }
    seed("dev_api_keys", { project_id: projectId, env: "test", kind: "secret", prefix: "sk_test_x", key_hash: "a".repeat(64), scopes: ["connect"], revoked_at: "2026-10-01T00:00:00.000Z" });
    seed("dev_api_keys", { project_id: projectId, env: "test", kind: "secret", prefix: "sk_test_x", key_hash: "b".repeat(64), scopes: ["connect"], expires_at: "2020-01-01T00:00:00.000Z" });
    await createProjectKey(OWNER, projectId, { env: "test", kind: "secret" });
    await expectHttp(createProjectKey(OWNER, projectId, { env: "test", kind: "secret" }), 409, "KEY_LIMIT");
    await createProjectKey(OWNER, projectId, { env: "live", kind: "secret" });
  });

  it("🔒 revoke: off-reach 404, developer 403, owner revokes, twice is 409", async () => {
    const minted = await createProjectKey(OWNER, projectId, { env: "test", kind: "secret" });
    await expectHttp(revokeProjectKey(STRANGER, minted.key.id), 404);
    await expectHttp(revokeProjectKey(DEV, minted.key.id), 403);
    await revokeProjectKey(ADMIN, minted.key.id);
    expect(rows("dev_api_keys").find((k) => k.id === minted.key.id)?.revoked_at).toBeTruthy();
    await expectHttp(revokeProjectKey(OWNER, minted.key.id), 409, "KEY_REVOKED");
  });
});
