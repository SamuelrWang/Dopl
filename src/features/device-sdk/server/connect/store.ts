import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ConnectSessionRow, ConnectStore, ConnectionRow, DeviceRow } from "./store-types";

/**
 * Service-role access to `connect_sessions`, `connections`, `devices` (SDK rows), `dev_end_users`
 * and `dev_webhook_outbox` (`20261122400000_device_sdk_connect.sql`).
 * ⚠ Bypasses RLS, so every developer-facing read filters on (project_id, env) here.
 * ⚠ Token hashes are written, matched on, and never selected back out.
 */

const db = () => supabaseAdmin();

const SESSION_COLS =
  "id, project_id, env, end_user_id, external_user_id, allowed_kinds, requested_scopes, redirect_uri, branding, status, device_id, connection_id, claim_attempts, public_token_expires_at, expires_at, created_at";
const DEVICE_COLS =
  "id, kind, vendor, model, firmware, adapter_id, adapter_version, display_name, project_id, env, end_user_id, last_seen, created_at, revoked_at";
const CONNECTION_COLS =
  "id, project_id, env, end_user_id, device_id, granted_scopes, tier_grants, status, expires_at, revoked_at, created_at";

function fail(op: string, error: { message: string } | null): never {
  throw new Error(`connect store ${op} failed: ${error?.message ?? "no row"}`);
}

export const connectStore: ConnectStore = {
  async upsertEndUser({ projectId, env }, externalUserId) {
    const { data, error } = await db()
      .from("dev_end_users")
      .upsert(
        { project_id: projectId, env, external_user_id: externalUserId },
        { onConflict: "project_id,env,external_user_id", ignoreDuplicates: false }
      )
      .select("id")
      .single();
    if (error || !data) fail("upsertEndUser", error);
    return (data as { id: string }).id;
  },

  async findEndUser({ projectId, env }, externalUserId) {
    const { data, error } = await db()
      .from("dev_end_users")
      .select("id")
      .eq("project_id", projectId)
      .eq("env", env)
      .eq("external_user_id", externalUserId)
      .maybeSingle();
    if (error) fail("findEndUser", error);
    return (data as { id: string } | null)?.id ?? null;
  },

  async externalUserIdOf(endUserId) {
    const { data, error } = await db().from("dev_end_users").select("external_user_id").eq("id", endUserId).maybeSingle();
    if (error) fail("externalUserIdOf", error);
    return (data as { external_user_id: string } | null)?.external_user_id ?? null;
  },

  async projectBranding(projectId) {
    const { data, error } = await db().from("dev_projects").select("branding").eq("id", projectId).maybeSingle();
    if (error) fail("projectBranding", error);
    const b = (data as { branding: unknown } | null)?.branding;
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  },

  async insertSession(s) {
    const { data, error } = await db().from("connect_sessions").insert(s).select(SESSION_COLS).single();
    if (error || !data) fail("insertSession", error);
    return data as ConnectSessionRow;
  },

  async findSessionByTokenHash(hash) {
    const { data, error } = await db().from("connect_sessions").select(SESSION_COLS).eq("token_hash", hash).maybeSingle();
    if (error) fail("findSessionByTokenHash", error);
    return (data as ConnectSessionRow | null) ?? null;
  },

  async transitionSession(id, from, patch) {
    const { data, error } = await db()
      .from("connect_sessions")
      .update(patch)
      .eq("id", id)
      .eq("status", from)
      .select("id");
    if (error) fail("transitionSession", error);
    return Array.isArray(data) && data.length === 1;
  },

  async bumpClaimAttempts(id) {
    // Read-then-write: a lost increment under a race only loosens the cap by one; the per-IP limiter
    // on the claim route is the hard ceiling.
    const { data, error } = await db().from("connect_sessions").select("claim_attempts").eq("id", id).single();
    if (error || !data) fail("bumpClaimAttempts", error);
    const next = (data as { claim_attempts: number }).claim_attempts + 1;
    const upd = await db().from("connect_sessions").update({ claim_attempts: next }).eq("id", id);
    if (upd.error) fail("bumpClaimAttempts", upd.error);
    return next;
  },

  async findSessionByPublicTokenHash({ projectId, env }, hash) {
    const { data, error } = await db()
      .from("connect_sessions")
      .select(SESSION_COLS)
      .eq("public_token_hash", hash)
      .eq("project_id", projectId)
      .eq("env", env)
      .maybeSingle();
    if (error) fail("findSessionByPublicTokenHash", error);
    return (data as ConnectSessionRow | null) ?? null;
  },

  async insertDevice(d) {
    const { now, ...row } = d;
    const { data, error } = await db()
      .from("devices")
      .insert({ ...row, last_seen: now, created_at: now })
      .select(DEVICE_COLS)
      .single();
    if (error || !data) fail("insertDevice", error);
    return data as DeviceRow;
  },

  async getDevice(id) {
    const { data, error } = await db().from("devices").select(DEVICE_COLS).eq("id", id).maybeSingle();
    if (error) fail("getDevice", error);
    return (data as DeviceRow | null) ?? null;
  },

  async revokeDevice(id, now) {
    const { error } = await db().from("devices").update({ revoked_at: now }).eq("id", id).is("revoked_at", null);
    if (error) fail("revokeDevice", error);
  },

  async insertConnection(c) {
    const { now, ...row } = c;
    const { data, error } = await db()
      .from("connections")
      .insert({ ...row, created_at: now })
      .select(CONNECTION_COLS)
      .single();
    if (error || !data) fail("insertConnection", error);
    return data as ConnectionRow;
  },

  async getConnection({ projectId, env }, id) {
    const { data, error } = await db()
      .from("connections")
      .select(CONNECTION_COLS)
      .eq("id", id)
      .eq("project_id", projectId)
      .eq("env", env)
      .maybeSingle();
    if (error) fail("getConnection", error);
    return (data as ConnectionRow | null) ?? null;
  },

  async listConnections({ projectId, env }, endUserId) {
    const { data, error } = await db()
      .from("connections")
      .select(CONNECTION_COLS)
      .eq("project_id", projectId)
      .eq("env", env)
      .eq("end_user_id", endUserId)
      .order("created_at", { ascending: true });
    if (error) fail("listConnections", error);
    return (data as ConnectionRow[] | null) ?? [];
  },

  async revokeConnection({ projectId, env }, id, now) {
    const { data, error } = await db()
      .from("connections")
      .update({ status: "revoked", revoked_at: now })
      .eq("id", id)
      .eq("project_id", projectId)
      .eq("env", env)
      .is("revoked_at", null)
      .select(CONNECTION_COLS)
      .maybeSingle();
    if (error) fail("revokeConnection", error);
    return (data as ConnectionRow | null) ?? null;
  },

  async insertOutbox(row) {
    const { error } = await db().from("dev_webhook_outbox").insert(row);
    if (error) fail("insertOutbox", error);
  },
};
