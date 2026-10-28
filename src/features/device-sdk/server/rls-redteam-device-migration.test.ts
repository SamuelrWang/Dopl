/**
 * REDTEAM / LIVE — `20261122900000_device_sdk_prosumer_migration.sql` (W1.1, Plans/Dopl SDK Split §8).
 * Runs only in CI's `rls-redteam` job (`RLS_REDTEAM_LIVE=1`, loopback stack after `supabase db reset`).
 * Proves against real Postgres: migrate keeps the device id and stays XOR, is idempotent, refuses a
 * non-internal project; the flag needs a migrated row; a legacy revoke reaches the SDK copy; revert
 * restores the prosumer row and clears the flag; a caller-scoped client can execute none of it.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { callerClient, deleteUsers, liveRedteamEnabled, makeUser } from "@/shared/supabase/rls-redteam-fixture";

const admin = () => supabaseAdmin();
const sha = () => createHash("sha256").update(randomBytes(32)).digest("hex");

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  if (data == null) throw new Error("no data");
  return data;
}

async function makeProject(ownerId: string, internal: boolean): Promise<{ orgId: string; projectId: string }> {
  const org = await must(admin().from("dev_orgs").insert({ name: "redteam", owner_user_id: ownerId, internal }).select("id").single());
  const project = await must(admin().from("dev_projects").insert({ org_id: org.id, name: "Dopl App" }).select("id").single());
  return { orgId: org.id as string, projectId: project.id as string };
}

async function makeLink(userId: string, tokenHash: string): Promise<string> {
  const row = await must(
    admin().from("glasses_device_links").insert({ user_id: userId, name: "Even G2", platform: "even_g2", token_hash: tokenHash }).select("id").single()
  );
  return row.id as string;
}

/** A write with no `.select()`: Supabase returns `data: null` on success. */
async function ok(p: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await p;
  if (error) throw new Error(error.message);
}

const device = async (id: string) =>
  must(admin().from("devices").select("id, user_id, project_id, env, end_user_id, revoked_at").eq("id", id).single());
const liveCreds = async (id: string) =>
  must(admin().from("device_credentials").select("hash").eq("device_id", id).eq("kind", "device_token").is("revoked_at", null));
const liveConnections = async (id: string) =>
  must(admin().from("connections").select("id, status").eq("device_id", id).is("revoked_at", null));
const state = async (userId: string) =>
  (await must(admin().rpc("sdk_delivery_state", { p_user_id: userId })))[0] as { enabled: boolean; device_ids: string[] };

describe.skipIf(!liveRedteamEnabled)("REDTEAM device migration (live)", () => {
  let userId = "";
  let otherId = "";
  let orgIds: string[] = [];
  let projectId = "";
  let customerProjectId = "";
  let linkId = "";
  let tokenHash = "";

  beforeAll(async () => {
    userId = await makeUser("devmig");
    otherId = await makeUser("devmig-other");
    const internal = await makeProject(userId, true);
    const customer = await makeProject(otherId, false);
    orgIds = [internal.orgId, customer.orgId];
    projectId = internal.projectId;
    customerProjectId = customer.projectId;
    tokenHash = sha();
    linkId = await makeLink(userId, tokenHash);
  });

  afterAll(async () => {
    for (const id of orgIds) await admin().from("dev_orgs").delete().eq("id", id);
    await deleteUsers([userId, otherId]);
  });

  it("🔒 a caller-scoped client cannot execute any of the functions", async () => {
    const c = callerClient(userId);
    for (const [fn, args] of [
      ["migrate_prosumer_device", { p_user_id: userId, p_project_id: projectId }],
      ["revert_sdk_device", { p_device_id: linkId }],
      ["sdk_delivery_state", { p_user_id: userId }],
      ["set_sdk_delivery", { p_user_id: userId, p_on: true }],
    ] as const) {
      const { error } = await c.rpc(fn, args);
      expect(error, fn).not.toBeNull();
    }
    expect((await device(linkId)).user_id).toBe(userId);
  });

  it("🔒 refuses a project whose org is not internal", async () => {
    const { error } = await admin().rpc("migrate_prosumer_device", { p_user_id: userId, p_project_id: customerProjectId });
    expect(error?.message).toMatch(/not an internal/);
    expect((await device(linkId)).user_id).toBe(userId);
  });

  it("🔒 the flag cannot go on before a device migrated", async () => {
    const { error } = await admin().rpc("set_sdk_delivery", { p_user_id: userId, p_on: true });
    expect(error?.message).toMatch(/no migrated glasses/);
    expect(await state(userId)).toEqual({ enabled: false, device_ids: [] });
  });

  it("migrates: same id, SDK shape, credential = legacy hash, active connection, legacy link untouched", async () => {
    const out = await must(admin().rpc("migrate_prosumer_device", { p_user_id: userId, p_project_id: projectId }));
    expect(out).toEqual([{ device_id: linkId, outcome: "migrated" }]);
    const d = await device(linkId);
    expect(d).toMatchObject({ id: linkId, user_id: null, project_id: projectId, env: "live", revoked_at: null });
    const eu = await must(admin().from("dev_end_users").select("external_user_id").eq("id", d.end_user_id as string).single());
    expect(eu.external_user_id).toBe(userId);
    expect(await liveCreds(linkId)).toEqual([{ hash: tokenHash }]);
    expect(await liveConnections(linkId)).toEqual([expect.objectContaining({ status: "active" })]);
    const link = await must(admin().from("glasses_device_links").select("user_id, token_hash, revoked_at").eq("id", linkId).single());
    expect(link).toEqual({ user_id: userId, token_hash: tokenHash, revoked_at: null });
  });

  it("is idempotent: a second call changes nothing", async () => {
    const out = await must(admin().rpc("migrate_prosumer_device", { p_user_id: userId, p_project_id: projectId }));
    expect(out).toEqual([{ device_id: linkId, outcome: "already" }]);
    expect(await liveCreds(linkId)).toHaveLength(1);
    expect(await liveConnections(linkId)).toHaveLength(1);
  });

  it("🔒 XOR holds: a row with both owners is refused by Postgres", async () => {
    const { error } = await admin().from("devices").update({ user_id: userId }).eq("id", linkId);
    expect(error?.message).toMatch(/devices_owner_shape_check/);
  });

  it("flag on only now; state reports the device", async () => {
    expect(await state(userId)).toEqual({ enabled: false, device_ids: [linkId] });
    expect(await must(admin().rpc("set_sdk_delivery", { p_user_id: userId, p_on: true }))).toBe(true);
    expect(await state(userId)).toEqual({ enabled: true, device_ids: [linkId] });
  });

  it("🔒 a legacy token rotation revokes the old copy and mirrors the new hash", async () => {
    const next = sha();
    await ok(admin().from("glasses_device_links").update({ token_hash: next }).eq("id", linkId));
    expect(await liveCreds(linkId)).toEqual([{ hash: next }]);
    tokenHash = next;
  });

  it("reverts: prosumer row back, credential + connection revoked, flag cleared", async () => {
    expect(await must(admin().rpc("revert_sdk_device", { p_device_id: linkId }))).toBe(userId);
    const d = await device(linkId);
    expect(d).toMatchObject({ user_id: userId, project_id: null, env: null, end_user_id: null, revoked_at: null });
    expect(await liveCreds(linkId)).toEqual([]);
    expect(await liveConnections(linkId)).toEqual([]);
    expect(await state(userId)).toEqual({ enabled: false, device_ids: [] });
    const flag = await must(admin().from("sdk_delivery_users").select("user_id").eq("user_id", userId));
    expect(flag).toEqual([]);
  });

  it("re-migrates after a revert (revives the credential, new connection)", async () => {
    const out = await must(admin().rpc("migrate_prosumer_device", { p_user_id: userId, p_project_id: projectId }));
    expect(out).toEqual([{ device_id: linkId, outcome: "migrated" }]);
    expect(await liveCreds(linkId)).toEqual([{ hash: tokenHash }]);
    expect(await liveConnections(linkId)).toHaveLength(1);
  });

  it("🔒 a legacy revoke (unpair) revokes the device, credential and connection", async () => {
    await ok(admin().from("glasses_device_links").update({ revoked_at: new Date().toISOString() }).eq("id", linkId));
    expect((await device(linkId)).revoked_at).not.toBeNull();
    expect(await liveCreds(linkId)).toEqual([]);
    expect(await liveConnections(linkId)).toEqual([]);
    expect(await state(userId)).toMatchObject({ enabled: false, device_ids: [] });
  });

  it("🔒 deleting the legacy link deletes the SDK copy and its credential", async () => {
    const h = sha();
    const second = await makeLink(userId, h);
    await must(admin().rpc("migrate_prosumer_device", { p_user_id: userId, p_project_id: projectId }));
    await ok(admin().from("glasses_device_links").delete().eq("id", second));
    expect(await must(admin().from("devices").select("id").eq("id", second))).toEqual([]);
    expect(await must(admin().from("device_credentials").select("id").eq("hash", h))).toEqual([]);
  });
});
