import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { mintApiKey } from "./keys";
import type { DoplAppSeedStore, SeedKey } from "./seed-dopl-app";
import type { Environment } from "../types";

/**
 * Supabase (service role) implementation of `DoplAppSeedStore`. Keys are minted through
 * `mintApiKey` (hash stored, raw returned once). Reads never select `key_hash`.
 */

function fail(op: string, message: string): never {
  throw new Error(`seed-dopl-app ${op} failed: ${message}`);
}

/** Abort early when `dev_orgs.internal` (migration 20261122800000) is not applied. */
export async function assertInternalOrgsSchema(): Promise<void> {
  const { error } = await supabaseAdmin().from("dev_orgs").select("id, internal").limit(1);
  if (error) {
    throw new Error(
      `dev_orgs.internal is not readable (${error.message}). Apply migration 20261122800000_device_sdk_internal_orgs.sql first.`
    );
  }
}

export function supabaseDoplAppSeedStore(): DoplAppSeedStore {
  const db = supabaseAdmin();
  return {
    async findOrgs(ownerUserId, name) {
      const { data, error } = await db
        .from("dev_orgs")
        .select("id, internal")
        .eq("owner_user_id", ownerUserId)
        .eq("name", name);
      if (error) fail("findOrgs", error.message);
      return (data ?? []) as Array<{ id: string; internal: boolean }>;
    },
    async createInternalOrg(ownerUserId, name) {
      const { data, error } = await db
        .from("dev_orgs")
        .insert({ owner_user_id: ownerUserId, name, internal: true })
        .select("id, internal")
        .single();
      if (error) fail("createInternalOrg", error.message);
      return data as { id: string; internal: boolean };
    },
    async markOrgInternal(orgId) {
      const { error } = await db.from("dev_orgs").update({ internal: true }).eq("id", orgId);
      if (error) fail("markOrgInternal", error.message);
    },
    async hasOwnerMember(orgId, userId) {
      const { data, error } = await db
        .from("dev_org_members")
        .select("role")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("hasOwnerMember", error.message);
      return (data as { role: string } | null)?.role === "owner";
    },
    async addOwnerMember(orgId, userId) {
      // Upsert: a non-owner membership row for the same pair is promoted, not duplicated.
      const { error } = await db
        .from("dev_org_members")
        .upsert({ org_id: orgId, user_id: userId, role: "owner" }, { onConflict: "org_id,user_id" });
      if (error) fail("addOwnerMember", error.message);
    },
    async findProjects(orgId, name) {
      const { data, error } = await db.from("dev_projects").select("id").eq("org_id", orgId).eq("name", name);
      if (error) fail("findProjects", error.message);
      return (data ?? []) as Array<{ id: string }>;
    },
    async createProject(orgId, name) {
      const { data, error } = await db.from("dev_projects").insert({ org_id: orgId, name }).select("id").single();
      if (error) fail("createProject", error.message);
      return data as { id: string };
    },
    async listUsableSecretKeys(projectId, env: Environment, now) {
      const { data, error } = await db
        .from("dev_api_keys")
        .select("id, env, prefix")
        .eq("project_id", projectId)
        .eq("env", env)
        .eq("kind", "secret")
        .is("revoked_at", null)
        .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);
      if (error) fail("listUsableSecretKeys", error.message);
      return (data ?? []) as SeedKey[];
    },
    async mintSecretKey(projectId, env) {
      const { secret, key } = await mintApiKey({ projectId, env, kind: "secret" });
      return { secret, key: { id: key.id, env: key.env, prefix: key.prefix } };
    },
  };
}
