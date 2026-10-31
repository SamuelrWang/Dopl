import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { ContextProfileSchema, type ContextProfile } from "../types";
import { actionTimeColumns } from "./column-compat";
import type { DeliveryStore, DeviceRow, NewAction, Scope, StoredAction } from "./delivery-store";

/**
 * `DeliveryStore` over Supabase (service role). Every read filters on (project_id, env): a key of
 * one project or env can never reach another's end users, devices, profiles or actions.
 */

const DEVICE_COLS = "id, kind, vendor, model, firmware, adapter_id, adapter_version, end_user_id, last_seen";
export const ACTION_COLS =
  "id, project_id, env, end_user_id, device_id, source, capability, intent, status, idempotency_key, request_hash, http_status, response, result, error, route_decision, created_at, updated_at";
/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";

const db = () => supabaseAdmin();

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** A `context_profiles` row → the C5 contract, or null if it no longer validates. */
function profileFromRow(row: { profile_id: string; version: number; match: unknown; body: unknown }): ContextProfile | null {
  const body = row.body && typeof row.body === "object" ? row.body : {};
  const parsed = ContextProfileSchema.safeParse({ ...body, id: row.profile_id, version: row.version, match: row.match });
  if (!parsed.success) {
    console.warn(`[device-sdk] skipped invalid context profile ${row.profile_id}@${row.version}`);
    return null;
  }
  return parsed.data;
}

export const supabaseDeliveryStore: DeliveryStore = {
  async findEndUser(s, externalUserId) {
    const data = must(
      await db()
        .from("dev_end_users")
        .select("id")
        .eq("project_id", s.projectId)
        .eq("env", s.env)
        .eq("external_user_id", externalUserId)
        .maybeSingle()
    );
    return (data as { id: string } | null) ?? null;
  },
  async listDevices(s, endUserId) {
    const data = must(
      await db()
        .from("devices")
        .select(DEVICE_COLS)
        .eq("project_id", s.projectId)
        .eq("env", s.env)
        .eq("end_user_id", endUserId)
        .is("revoked_at", null)
    );
    return (data ?? []) as DeviceRow[];
  },
  async getDevice(s, deviceId) {
    // A non-uuid id cannot exist; skip the round trip (and Postgres's cast error).
    if (!isUuid(deviceId)) return null;
    const data = must(
      await db()
        .from("devices")
        .select(DEVICE_COLS)
        .eq("id", deviceId)
        .eq("project_id", s.projectId)
        .eq("env", s.env)
        .is("revoked_at", null)
        .maybeSingle()
    );
    return (data as DeviceRow | null) ?? null;
  },
  async externalUserId(s, endUserId) {
    const data = must(
      await db().from("dev_end_users").select("external_user_id").eq("id", endUserId).eq("project_id", s.projectId).eq("env", s.env).maybeSingle()
    );
    return (data as { external_user_id: string } | null)?.external_user_id ?? null;
  },
  async listProfiles(s) {
    const data = must(
      await db().from("context_profiles").select("profile_id, version, match, body").eq("project_id", s.projectId).eq("env", s.env).eq("active", true)
    );
    return ((data ?? []) as Array<{ profile_id: string; version: number; match: unknown; body: unknown }>)
      .map(profileFromRow)
      .filter((p): p is ContextProfile => p !== null);
  },
  async findActionByKey(s, key) {
    const data = must(
      await db().from("dev_actions").select(ACTION_COLS).eq("project_id", s.projectId).eq("env", s.env).eq("idempotency_key", key).maybeSingle()
    );
    return (data as StoredAction | null) ?? null;
  },
  async insertAction(row: NewAction) {
    const res = await db().from("dev_actions").insert(row).select(ACTION_COLS).single();
    if (res.error && (res.error as { code?: string }).code === UNIQUE_VIOLATION) {
      const existing = await supabaseDeliveryStore.findActionByKey({ projectId: row.project_id, env: row.env }, row.idempotency_key);
      if (existing) return { inserted: false as const, existing };
    }
    return { inserted: true as const, action: must(res) as StoredAction };
  },
  async updateAction(s: Scope, id, patch) {
    const write = (row: typeof patch) =>
      db()
        .from("dev_actions")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("project_id", s.projectId)
        .eq("env", s.env)
        .select(ACTION_COLS)
        .maybeSingle();
    let res = await write(actionTimeColumns.shape(patch));
    if (res.error && actionTimeColumns.isMissing(res.error)) res = await write(actionTimeColumns.fallback(patch));
    return (must(res) as StoredAction | null) ?? null;
  },
  async getAction(s, id) {
    if (!isUuid(id)) return null;
    const data = must(
      await db().from("dev_actions").select(ACTION_COLS).eq("id", id).eq("project_id", s.projectId).eq("env", s.env).maybeSingle()
    );
    return (data as StoredAction | null) ?? null;
  },
  async countActionsSince(s, sinceIso) {
    const res = await db()
      .from("dev_actions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", s.projectId)
      .eq("env", s.env)
      .gte("created_at", sinceIso);
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  },
};
