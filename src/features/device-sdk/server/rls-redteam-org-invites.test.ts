/**
 * REDTEAM / LIVE — `20261123210000_device_sdk_org_invites.sql` (P3 portal self-serve).
 * Runs only in CI's `rls-redteam` job (`RLS_REDTEAM_LIVE=1`, loopback stack after `supabase db reset`).
 * Proves against real Postgres: a caller-scoped client can neither read nor write invites; the
 * role check refuses `owner`; one open invite per (org, email); a revoked one frees the slot.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { callerClient, deleteUsers, liveRedteamEnabled, makeUser } from "@/shared/supabase/rls-redteam-fixture";

const admin = () => supabaseAdmin();
const sha = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const later = () => new Date(Date.now() + 86_400_000).toISOString();

describe.skipIf(!liveRedteamEnabled)("REDTEAM org invites (live)", () => {
  let ownerId = "";
  let orgId = "";

  beforeAll(async () => {
    ownerId = await makeUser("orginv");
    const { data, error } = await admin().from("dev_orgs").insert({ name: "redteam", owner_user_id: ownerId }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "no org");
    orgId = data.id as string;
  });

  afterAll(async () => {
    await admin().from("dev_orgs").delete().eq("id", orgId);
    await deleteUsers([ownerId]);
  });

  const invite = (email: string, role = "developer") =>
    admin()
      .from("dev_org_invites")
      .insert({ org_id: orgId, email, role, token_hash: sha(), invited_by: ownerId, expires_at: later() })
      .select("id")
      .single();

  it("🔒 a caller-scoped client cannot read or insert", async () => {
    const seeded = await invite("seen@example.com");
    expect(seeded.error).toBeNull();
    const c = callerClient(ownerId);
    const read = await c.from("dev_org_invites").select("id");
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);
    const write = await c
      .from("dev_org_invites")
      .insert({ org_id: orgId, email: "x@example.com", role: "admin", token_hash: sha(), expires_at: later() });
    expect(write.error).not.toBeNull();
  });

  it("🔒 refuses role owner and an un-normalised email", async () => {
    expect((await invite("o@example.com", "owner")).error).not.toBeNull();
    expect((await invite("Mixed@Example.com")).error).not.toBeNull();
  });

  it("🔒 one open invite per (org, email); revoking frees the slot", async () => {
    const first = await invite("dup@example.com");
    expect(first.error).toBeNull();
    expect((await invite("dup@example.com")).error?.message).toMatch(/dev_org_invites_one_open_per_email/);
    await admin().from("dev_org_invites").update({ revoked_at: new Date().toISOString() }).eq("id", first.data!.id);
    expect((await invite("dup@example.com")).error).toBeNull();
  });
});
