import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  AttemptRow,
  DeliveryRow,
  EndpointRow,
  EndpointSecrets,
  ListPosition,
  WebhookStore,
} from "./store-types";

/**
 * The service-role {@link WebhookStore}. Every `dev_webhook_*` table is service role only (RLS on,
 * no policy). ⚠ TENANCY IS ENFORCED HERE: every endpoint-API read and write filters on the caller's
 * `(project_id, env)`; the sender methods are tenant-free by design (they run over all projects).
 * Endpoint rows never select `secret_id` / `previous_secret_id`.
 */

const ENDPOINT_COLS =
  "id, project_id, env, url, description, enabled_events, previous_secret_expires_at, disabled_at, created_at, updated_at";
const DELIVERY_COLS =
  "id, outbox_id, endpoint_id, project_id, env, event_type, status, attempts, next_attempt_at, last_status_code, last_error, delivered_at, created_at, updated_at";

const db = () => supabaseAdmin();

function fail(op: string, error: { message: string }): never {
  throw new Error(`webhook store ${op} failed: ${error.message}`);
}

const pickEndpoint = (r: Record<string, unknown>): EndpointRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  env: r.env as EndpointRow["env"],
  url: r.url as string,
  description: (r.description as string | null) ?? null,
  enabled_events: (r.enabled_events as EndpointRow["enabled_events"]) ?? null,
  previous_secret_expires_at: (r.previous_secret_expires_at as string | null) ?? null,
  disabled_at: (r.disabled_at as string | null) ?? null,
  created_at: r.created_at as string,
  updated_at: r.updated_at as string,
});

const pickDelivery = (r: Record<string, unknown>): DeliveryRow => ({
  id: r.id as string,
  outbox_id: r.outbox_id as string,
  endpoint_id: r.endpoint_id as string,
  project_id: r.project_id as string,
  env: r.env as DeliveryRow["env"],
  event_type: r.event_type as DeliveryRow["event_type"],
  status: r.status as DeliveryRow["status"],
  attempts: r.attempts as number,
  next_attempt_at: r.next_attempt_at as string,
  last_status_code: (r.last_status_code as number | null) ?? null,
  last_error: (r.last_error as string | null) ?? null,
  delivered_at: (r.delivered_at as string | null) ?? null,
  created_at: r.created_at as string,
  updated_at: r.updated_at as string,
});

/** `(created_at, id) < position`, newest first. Both parts were validated (ISO + UUID) by the cursor decoder. */
const beforeFilter = (p: ListPosition) => `created_at.lt."${p.createdAt}",and(created_at.eq."${p.createdAt}",id.lt.${p.id})`;

const first = (data: unknown): Record<string, unknown> | null => {
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Record<string, unknown>[];
  return rows[0] ?? null;
};

export const supabaseWebhookStore: WebhookStore = {
  async fanOut(limit) {
    const { data, error } = await db().rpc("dev_webhook_fan_out", { p_limit: limit });
    if (error) fail("fanOut", error);
    return (data as number | null) ?? 0;
  },

  async claim(limit, leaseSeconds) {
    const { data, error } = await db().rpc("dev_webhook_claim", { p_limit: limit, p_lease_seconds: leaseSeconds });
    if (error) fail("claim", error);
    return ((data ?? []) as Record<string, unknown>[]).map(pickDelivery);
  },

  async payloads(outboxIds) {
    const out = new Map<string, Record<string, unknown>>();
    if (outboxIds.length === 0) return out;
    const { data, error } = await db().from("dev_webhook_outbox").select("id, payload").in("id", [...outboxIds]);
    if (error) fail("payloads", error);
    for (const r of (data ?? []) as Array<{ id: string; payload: Record<string, unknown> }>) out.set(r.id, r.payload);
    return out;
  },

  async endpointsById(ids) {
    const out = new Map<string, EndpointRow>();
    if (ids.length === 0) return out;
    const { data, error } = await db().from("dev_webhook_endpoints").select(ENDPOINT_COLS).in("id", [...ids]);
    if (error) fail("endpointsById", error);
    for (const r of (data ?? []) as Record<string, unknown>[]) out.set(r.id as string, pickEndpoint(r));
    return out;
  },

  async secretsFor(endpointIds) {
    const out = new Map<string, EndpointSecrets>();
    if (endpointIds.length === 0) return out;
    const { data, error } = await db().rpc("dev_webhook_endpoint_secrets", { p_endpoint_ids: [...endpointIds] });
    if (error) fail("secretsFor", error);
    for (const r of (data ?? []) as EndpointSecrets[]) out.set(r.endpoint_id, r);
    return out;
  },

  async recordAttempt(deliveryId, o) {
    const { data, error } = await db().rpc("dev_webhook_record_attempt", {
      p_delivery_id: deliveryId,
      p_status_code: o.statusCode,
      p_error: o.error,
      p_duration_ms: Math.max(0, Math.round(o.durationMs)),
      p_response_body: o.responseBody,
      p_success: o.success,
      p_next_attempt_at: o.success ? null : (o.nextAttemptAt?.toISOString() ?? null),
    });
    if (error) fail("recordAttempt", error);
    const row = first(data);
    return row ? pickDelivery(row) : null;
  },

  async createEndpoint(t, input) {
    const { data, error } = await db().rpc("dev_webhook_create_endpoint", {
      p_project_id: t.projectId,
      p_env: t.env,
      p_url: input.url,
      p_description: input.description,
      p_enabled_events: input.enabledEvents,
      p_secret: input.secret,
    });
    if (error) fail("createEndpoint", error);
    const row = first(data);
    if (!row) throw new Error("webhook store createEndpoint returned no row");
    return pickEndpoint(row);
  },

  async getEndpoint(t, id) {
    const { data, error } = await db()
      .from("dev_webhook_endpoints")
      .select(ENDPOINT_COLS)
      .eq("id", id)
      .eq("project_id", t.projectId)
      .eq("env", t.env)
      .maybeSingle();
    if (error) fail("getEndpoint", error);
    return data ? pickEndpoint(data as Record<string, unknown>) : null;
  },

  async listEndpoints(t, after, limit) {
    let q = db().from("dev_webhook_endpoints").select(ENDPOINT_COLS).eq("project_id", t.projectId).eq("env", t.env);
    if (after) q = q.or(beforeFilter(after));
    const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
    if (error) fail("listEndpoints", error);
    return ((data ?? []) as Record<string, unknown>[]).map(pickEndpoint);
  },

  async updateEndpoint(t, id, patch) {
    const { data, error } = await db()
      .from("dev_webhook_endpoints")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("project_id", t.projectId)
      .eq("env", t.env)
      .select(ENDPOINT_COLS)
      .maybeSingle();
    if (error) fail("updateEndpoint", error);
    return data ? pickEndpoint(data as Record<string, unknown>) : null;
  },

  async deleteEndpoint(t, id) {
    const { data, error } = await db()
      .from("dev_webhook_endpoints")
      .delete()
      .eq("id", id)
      .eq("project_id", t.projectId)
      .eq("env", t.env)
      .select("id");
    if (error) fail("deleteEndpoint", error);
    return ((data ?? []) as unknown[]).length > 0;
  },

  async rotateSecret(t, id, secret, overlapSeconds) {
    // The RPC is tenant-free: check ownership first (the row cannot change owner).
    if (!(await this.getEndpoint(t, id))) return null;
    const { data, error } = await db().rpc("dev_webhook_rotate_secret", {
      p_endpoint_id: id,
      p_new_secret: secret,
      p_overlap_seconds: overlapSeconds,
    });
    if (error) fail("rotateSecret", error);
    const row = first(data);
    return row ? pickEndpoint(row) : null;
  },

  async listDeliveries(t, endpointId, after, limit) {
    let q = db()
      .from("dev_webhook_deliveries")
      .select(DELIVERY_COLS)
      .eq("endpoint_id", endpointId)
      .eq("project_id", t.projectId)
      .eq("env", t.env);
    if (after) q = q.or(beforeFilter(after));
    const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
    if (error) fail("listDeliveries", error);
    return ((data ?? []) as Record<string, unknown>[]).map(pickDelivery);
  },

  async getDelivery(t, id) {
    const { data, error } = await db()
      .from("dev_webhook_deliveries")
      .select(DELIVERY_COLS)
      .eq("id", id)
      .eq("project_id", t.projectId)
      .eq("env", t.env)
      .maybeSingle();
    if (error) fail("getDelivery", error);
    return data ? pickDelivery(data as Record<string, unknown>) : null;
  },

  async attemptsFor(deliveryIds) {
    if (deliveryIds.length === 0) return [];
    const { data, error } = await db()
      .from("dev_webhook_attempts")
      .select("id, delivery_id, attempt, attempted_at, status_code, error, duration_ms, response_body")
      .in("delivery_id", [...deliveryIds])
      .order("attempt", { ascending: false });
    if (error) fail("attemptsFor", error);
    return (data ?? []) as AttemptRow[];
  },

  async replay(t, id) {
    if (!(await this.getDelivery(t, id))) return null;
    const { data, error } = await db().rpc("dev_webhook_replay", { p_delivery_id: id });
    if (error) fail("replay", error);
    const row = first(data);
    return row ? pickDelivery(row) : null;
  },
};
